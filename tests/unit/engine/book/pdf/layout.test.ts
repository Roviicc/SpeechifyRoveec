// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { groupLines, linesToBlocks, markRepeatedLines, pagesToBlocks, type PdfLine, type PdfTextItem } from '@/engine/book/pdf/layout'
import { findGutter, orderColumns } from '@/engine/book/pdf/columns'
import { isCaptionText, isTableRow, markFootnotes, markTables } from '@/engine/book/pdf/junk'
import { buildBookIndex } from '@/engine/book/bookIndex'
import { DEFAULT_SKIP } from '@/engine/text/types'
import type { Block, BookDoc } from '@/engine/book/types'

const item = (str: string, x: number, y: number, h = 10, hasEOL = false): PdfTextItem => ({
  str,
  transform: [h, 0, 0, h, x, y],
  width: str.length * h * 0.5,
  height: h,
  hasEOL,
})

/** Deterministic prose: `n` lines of ~`chars` characters, each tagged with a column letter and line number. */
function prose(tag: string, n: number, chars = 44): string[] {
  const words = 'the quick brown fox jumps over a lazy dog while reading aloud in columns'.split(' ')
  return Array.from({ length: n }, (_, i) => {
    let s = `${tag}${i}`
    let k = i
    while (s.length + 1 + words[k % words.length].length <= chars) s += ' ' + words[k++ % words.length]
    return s
  })
}

function checkSpans(items: PdfTextItem[], blocks: Block[]) {
  for (const b of blocks)
    for (const [i, bo, io, len] of b.spans ?? []) {
      expect(bo + len).toBeLessThanOrEqual(b.text.length)
      expect(b.text.slice(bo, bo + len)).toBe(items[i].str.slice(io, io + len))
    }
}

const text = (lines: PdfLine[]) => lines.map((l) => l.text)

// a 600pt-wide page: left column x 50–280, gutter, right column x 320–550
const LEFT = 50
const RIGHT = 320
const TOP = 700

describe('two-column layout', () => {
  it('reads the left column before the right one when the content stream is column by column', () => {
    const items = [
      item('A Study of Columns', 200, 760, 16),
      ...prose('L', 20).map((s, i) => item(s, LEFT, TOP - i * 12)),
      ...prose('R', 18).map((s, i) => item(s, RIGHT, TOP - i * 12)),
    ]
    const ordered = text(orderColumns(groupLines(items)))
    expect(ordered[0]).toBe('A Study of Columns')
    expect(ordered.slice(1, 21).every((t) => t.startsWith('L'))).toBe(true)
    expect(ordered.slice(21).every((t) => t.startsWith('R'))).toBe(true)
  })

  it('splits and reorders lines when the stream interleaves the columns row by row', () => {
    const L = prose('L', 16)
    const R = prose('R', 16)
    const items: PdfTextItem[] = [item('Full width title line spanning the whole page width', 120, 760, 14)]
    for (let i = 0; i < 16; i++) items.push(item(L[i], LEFT, TOP - i * 12), item(R[i], RIGHT, TOP - i * 12, 10, true))
    items.push(item('A full width closing note below both columns, long enough to cross the gutter clearly.', LEFT, 480))
    const lines = groupLines(items)
    // groupLines alone merges the two columns into one line per row
    expect(lines[1].text.startsWith('L0') && lines[1].text.includes('R0')).toBe(true)
    const ordered = orderColumns(lines)
    const t = text(ordered)
    expect(t[0]).toMatch(/^Full width title/)
    expect(t.slice(1, 17)).toEqual(L)
    expect(t.slice(17, 33)).toEqual(R)
    expect(t[33]).toMatch(/^A full width closing note/)
    checkSpans(items, linesToBlocks(ordered, 0))
    // paragraphs never mix the columns
    const blocks = linesToBlocks(ordered, 0)
    const iL = blocks.findIndex((b) => b.text.includes('L15'))
    const iR = blocks.findIndex((b) => b.text.includes('R0'))
    expect(iL).toBeLessThan(iR)
  })

  it('orders three columns left to right', () => {
    const cols = [40, 230, 420]
    const items: PdfTextItem[] = []
    for (const [c, x] of cols.entries()) prose('ABC'[c], 12, 30).forEach((s, i) => items.push(item(s, x, TOP - i * 12)))
    // stream order deliberately scrambled: right column first
    items.reverse()
    const t = text(orderColumns(groupLines(items)))
    expect(t.map((s) => s[0]).join('')).toBe('A'.repeat(12) + 'B'.repeat(12) + 'C'.repeat(12))
    expect(t.slice(0, 3)).toEqual(['A0 the quick brown fox jumps', 'A1 quick brown fox jumps over', 'A2 brown fox jumps over a lazy'])
  })

  it('continues a sentence from the bottom of the left column into the right one, and skips a column footnote', () => {
    const L = prose('L', 16)
    L[15] = 'and the sentence goes on past the column end'
    const R = prose('r', 16)
    R[0] = 'into the next column where it finally ends.'
    const items = [
      ...L.map((s, i) => item(s, LEFT, TOP - i * 12)),
      ...R.map((s, i) => item(s, RIGHT, TOP - i * 12)),
      item('1 A footnote at the foot of the right column.', RIGHT, TOP - 17 * 12, 8),
    ]
    const [blocks] = pagesToBlocks([groupLines(items)])
    const joined = blocks.find((b) => b.text.includes('past the column end'))!
    expect(joined.text).toContain('past the column end into the next column where it finally ends.')
    expect(blocks.find((b) => b.text.startsWith('1 A footnote'))?.skip).toBe('footnote')
    // reading order: left column, right column, then its footnote
    const at = (s: string) => blocks.findIndex((b) => b.text.includes(s))
    expect(at('1 A footnote')).toBeGreaterThan(at('r15'))
    checkSpans(items, blocks)
  })

  it('keeps single-column pages exactly as they were', () => {
    const items = [item('Chapter One', 50, 760, 18), ...prose('S', 30, 90).map((s, i) => item(s, 50, TOP - i * 12))]
    // ragged right, an indented paragraph start and a short last line
    items.push(item('    Indented new paragraph begins here and runs on.', 50, TOP - 31 * 12))
    const lines = groupLines(items)
    expect(findGutter(lines)).toBeNull()
    expect(orderColumns(lines)).toBe(lines)
    expect(pagesToBlocks([groupLines(items)])[0]).toEqual(linesToBlocks(groupLines(items), 0, 10))
  })

  it('does not treat a two-column table of short cells as text columns', () => {
    const items: PdfTextItem[] = []
    for (let i = 0; i < 14; i++) items.push(item(`Name ${i}`, LEFT, TOP - i * 12), item(`Value ${i}`, RIGHT, TOP - i * 12, 10, true))
    expect(findGutter(groupLines(items))).toBeNull()
  })

  it('leaves the sample PDF (single column) unchanged apart from new skips', async () => {
    const data = new Uint8Array(readFileSync('tests/fixtures/sound.pdf'))
    const pdf = await getDocument({ data, useSystemFonts: true }).promise
    const pages: PdfTextItem[][] = []
    for (let p = 1; p <= pdf.numPages; p++) pages.push((await (await pdf.getPage(p)).getTextContent()).items.filter((i) => 'str' in i) as PdfTextItem[])
    const before = pages.map((items) => groupLines(items))
    markRepeatedLines(before)
    const body = before.flat().filter((l) => !l.role).map((l) => l.h).sort((a, b) => a - b)
    const old = before.map((lines, i) => linesToBlocks(lines, i, body[body.length >> 1]))
    const now = pagesToBlocks(pages.map((items) => groupLines(items)))
    expect(now).toEqual(old)
  })
})

describe('footnotes, captions and tables', () => {
  const page = (extra: PdfTextItem[]) => [...prose('B', 20, 90).map((s, i) => item(s, 50, TOP - i * 12)), ...extra]

  it('skips small-print footnotes at the bottom of the page', () => {
    const items = page([item('1 See the appendix for the full derivation of', 50, 120, 8), item('the result, which is long and spans two lines.', 50, 111, 8), item('2 Another note.', 50, 102, 8)])
    const [blocks] = pagesToBlocks([groupLines(items)])
    const notes = blocks.filter((b) => b.skip === 'footnote')
    expect(notes.map((b) => b.text)).toEqual(['1 See the appendix for the full derivation of the result, which is long and spans two lines.', '2 Another note.'])
    expect(blocks.filter((b) => !b.skip).every((b) => b.text.startsWith('B'))).toBe(true)
    checkSpans(items, blocks)
    const doc: BookDoc = { version: 1, type: 'pdf', title: 't', toc: [], sections: [{ title: 'p', blocks }] }
    const spoken = buildBookIndex(doc, { skip: DEFAULT_SKIP, dictionary: [] }).sentences.map((s) => s.spoken.text).join(' ')
    expect(spoken).not.toMatch(/appendix/)
    const kept = buildBookIndex(doc, { skip: { ...DEFAULT_SKIP, footnoteText: false }, dictionary: [] }).sentences.map((s) => s.spoken.text).join(' ')
    expect(kept).toMatch(/appendix/)
  })

  it('reads small text that is not a footnote, and normal-size lines starting with a number', () => {
    const smallProse = page([item('Printed with care in a small typeface for the', 50, 120, 8), item('colophon of this edition.', 50, 111, 8)])
    expect(pagesToBlocks([groupLines(smallProse)])[0].some((b) => b.skip)).toBe(false)
    const numbered = page([item('3 men walked into the room and sat down quietly.', 50, 120)])
    expect(pagesToBlocks([groupLines(numbered)])[0].some((b) => b.skip)).toBe(false)
    // small text with a marker that is followed by body text is not at the bottom
    const lines = groupLines([item('1 small aside in the middle', 50, 760, 8), ...page([])])
    markFootnotes(lines, 10)
    expect(lines.some((l) => l.role)).toBe(false)
  })

  it('skips short figure/table captions only', () => {
    expect(isCaptionText('Figure 3. The experimental setup.')).toBe(true)
    expect(isCaptionText('Fig. 2: Results')).toBe(true)
    expect(isCaptionText('Table 1')).toBe(true)
    expect(isCaptionText('TABLE IV — Error rates')).toBe(true)
    expect(isCaptionText('Figure 2.1: Overview of the pipeline')).toBe(true)
    expect(isCaptionText('Figure 3 shows the setup we used for every run.')).toBe(false)
    expect(isCaptionText('Tables were set for dinner.')).toBe(false)
    expect(isCaptionText('Figure 3. ' + 'A very long caption that keeps going '.repeat(6))).toBe(false)
    const [blocks] = pagesToBlocks([groupLines(page([item('Figure 3. The experimental setup.', 50, 400)]))])
    expect(blocks.find((b) => b.text.startsWith('Figure'))?.skip).toBe('caption')
  })

  it('skips runs of table rows but not prose with numbers', () => {
    const rows = [
      [item('Year', 50, 300), item('Sales', 150, 300), item('Growth', 250, 300, 10, true)],
      [item('2019', 50, 288), item('1,204', 150, 288), item('3.2%', 250, 288, 10, true)],
      [item('2020', 50, 276), item('1,388', 150, 276), item('15.3%', 250, 276, 10, true)],
      [item('2021', 50, 264), item('1,512', 150, 264), item('8.9%', 250, 264, 10, true)],
    ].flat()
    const lines = groupLines(page(rows))
    markTables(lines)
    expect(lines.filter((l) => l.role === 'table').map((l) => l.text)).toEqual(['Year Sales Growth', '2019 1,204 3.2%', '2020 1,388 15.3%', '2021 1,512 8.9%'])
    // prose with numbers in it
    const proseLines = groupLines([
      item('In 2019 the company sold 1,204 units, up 3.2% from the year before,', 50, 300),
      item('and in 2020 it sold 1,388 units as demand kept rising across', 50, 288),
      item('every region; 2021 brought 1,512 units and a new factory.', 50, 276),
    ])
    expect(proseLines.some(isTableRow)).toBe(false)
    markTables(proseLines)
    expect(proseLines.some((l) => l.role)).toBe(false)
    // fewer than three rows: kept
    const two = groupLines([item('1 2 3', 50, 300), item('4 5 6', 50, 288)])
    markTables(two)
    expect(two.some((l) => l.role)).toBe(false)
  })
})
