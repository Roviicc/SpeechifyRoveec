// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { groupLines, linesToBlocks, markRepeatedLines, type PdfLine, type PdfTextItem } from '../../src/engine/doc/pdfLayout'
import { buildBookIndex } from '../../src/engine/doc/bookIndex'
import { DEFAULT_SKIP } from '../../src/engine/text/types'
import type { BookDoc } from '../../src/engine/doc/types'

async function loadPages(file: string): Promise<PdfLine[][]> {
  const data = new Uint8Array(readFileSync(`tests/fixtures/${file}`))
  const pdf = await getDocument({ data, useSystemFonts: true }).promise
  const pages: PdfLine[][] = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent()
    pages.push(groupLines(tc.items.filter((i) => 'str' in i) as PdfTextItem[]))
  }
  return pages
}

describe('PDF layout', () => {
  it('groups items into lines and de-hyphenates paragraphs', () => {
    const item = (str: string, x: number, y: number, width = str.length * 5): PdfTextItem => ({ str, transform: [10, 0, 0, 10, x, y], width, height: 10 })
    const lines = groupLines([item('The quick brown fox jum-', 0, 100), item('ped over', 0, 88), item('the dog.', 45, 88), item('New para', 0, 60)])
    expect(lines.map((l) => l.text)).toEqual(['The quick brown fox jum-', 'ped over the dog.', 'New para'])
    const blocks = linesToBlocks(lines, 0)
    expect(blocks.map((b) => b.text)).toEqual(['The quick brown fox jumped over the dog.', 'New para'])
    // spans map block text back to items
    const b = blocks[0]
    const rebuilt = b.spans!.map(([i, bo, io, len]) => [i, b.text.slice(bo, bo + len), io] as const)
    expect(rebuilt[0]).toEqual([0, 'The quick brown fox jum', 0])
    expect(rebuilt[1]).toEqual([1, 'ped over', 0])
  })

  it('detects running headers, footers and page numbers in the fixture', async () => {
    const pages = await loadPages('sound.pdf')
    expect(pages.length).toBeGreaterThanOrEqual(3)
    markRepeatedLines(pages)
    const roles = pages.flat().filter((l) => l.role)
    expect(roles.some((l) => l.role === 'header' && /Journal of Everyday Acoustics/.test(l.text))).toBe(true)
    expect(roles.filter((l) => l.role === 'pagenum').length).toBeGreaterThanOrEqual(pages.length - 1)

    const doc: BookDoc = {
      version: 1,
      type: 'pdf',
      title: 'Sound',
      toc: [],
      sections: pages.map((lines, i) => ({ title: `Page ${i + 1}`, blocks: linesToBlocks(lines, i) })),
    }
    const idx = buildBookIndex(doc, { skip: DEFAULT_SKIP, dictionary: [] })
    const spoken = idx.sentences.map((s) => s.spoken.text).join(' ')
    expect(spoken).not.toMatch(/Journal of Everyday Acoustics/)
    expect(spoken).not.toMatch(/\[\d/)
    expect(spoken).not.toMatch(/Smith, 2020/)
    expect(spoken).toMatch(/available at link for anyone/)
    expect(spoken).toMatch(/Section 1: How sound moves/)
  })
})
