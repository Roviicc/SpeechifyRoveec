// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { groupLines, pagesToBlocks, type PdfTextItem } from '@/engine/book/pdf/layout'
import { findGutter } from '@/engine/book/pdf/columns'
import { buildBookIndex } from '@/engine/book/bookIndex'
import { DEFAULT_SKIP } from '@/engine/text/types'
import type { BookDoc } from '@/engine/book/types'

describe('two-column fixture (tests/fixtures/columns.pdf)', () => {
  it('reads title, abstract, the left column, then the right column, skipping caption, table and footnote', async () => {
    const pdf = await getDocument({ data: new Uint8Array(readFileSync('tests/fixtures/columns.pdf')), useSystemFonts: true }).promise
    const items: PdfTextItem[][] = []
    for (let p = 1; p <= pdf.numPages; p++) items.push((await (await pdf.getPage(p)).getTextContent()).items.filter((i) => 'str' in i) as PdfTextItem[])
    expect(findGutter(groupLines(items[0]))).not.toBeNull()
    const pages = pagesToBlocks(items.map((it) => groupLines(it)))
    const blocks = pages.flat()
    // spans stay exact
    blocks.forEach((b) => {
      for (const [i, bo, io, len] of b.spans ?? []) expect(b.text.slice(bo, bo + len)).toBe(items[b.page!][i].str.slice(io, io + len))
    })
    const doc: BookDoc = { version: 1, type: 'pdf', title: 'c', toc: [], sections: pages.map((blocks, i) => ({ title: `Page ${i + 1}`, blocks })) }
    const spoken = buildBookIndex(doc, { skip: DEFAULT_SKIP, dictionary: [] }).sentences.map((s) => s.spoken.text).join(' ')
    const order = ['Reading Columns Aloud', 'Abstract.', 'Paragraph one', 'Paragraph two', 'Paragraph three', 'Paragraph four', 'Paragraph five', 'Paragraph six'].map((s) => spoken.indexOf(s))
    expect(order.every((v) => v >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    // whole sentences survive (no interleaving across the gutter)
    expect(spoken).toContain('A careful reader moves down one column to its end and then starts again at the top of the next column, and so should a voice.')
    expect(spoken).not.toMatch(/Figure 1/)
    expect(spoken).not.toMatch(/1,388/)
    expect(spoken).not.toMatch(/This footnote/)
    expect(blocks.find((b) => b.text.startsWith('1 This footnote'))?.skip).toBe('footnote')
  })
})
