import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractBlocks, parseEpub, resolvePath } from '../../src/engine/doc/epub'
import { buildBookIndex } from '../../src/engine/doc/bookIndex'
import { DEFAULT_SKIP } from '../../src/engine/text/types'

describe('EPUB parsing', () => {
  it('resolves relative paths', () => {
    expect(resolvePath('OEBPS/content.opf', 'text/ch1.xhtml#x')).toBe('OEBPS/text/ch1.xhtml')
    expect(resolvePath('OEBPS/text/ch1.xhtml', '../images/a%20b.png')).toBe('OEBPS/images/a b.png')
  })

  it('extracts blocks, headings and footnote markers from XHTML', () => {
    const doc = new DOMParser().parseFromString(
      `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
        <h2 id="h">A  <em>Title</em></h2>
        <div>Loose text <p>Para one.<sup><a epub:type="noteref" href="#n">3</a></sup> More.</p> tail</div>
        <script>ignored()</script>
      </body></html>`,
      'application/xhtml+xml',
    )
    const blocks = extractBlocks(doc.getElementsByTagName('body')[0])
    expect(blocks.map((b) => [b.kind, b.text])).toEqual([
      ['h', 'A Title'],
      ['p', 'Loose text'],
      ['p', 'Para one.3 More.'],
      ['p', 'tail'],
    ])
    expect(blocks[0].ids).toEqual(['h'])
    expect(blocks[2].notes).toEqual([[9, 10]])
  })

  it('parses the fixture book with TOC, cover and readable sentences', async () => {
    const buf = readFileSync('tests/fixtures/alice.epub')
    const { doc, cover } = await parseEpub(buf)
    expect(doc.title).toBe('Alice’s Adventures in Wonderland')
    expect(doc.author).toBe('Lewis Carroll')
    expect(doc.sections).toHaveLength(3)
    expect(doc.toc.map((t) => t.title)).toEqual([
      'Chapter I. Down the Rabbit-Hole',
      'Chapter II. The Pool of Tears',
      'Chapter III. A Caucus-Race and a Long Tale',
    ])
    expect(cover?.type).toBe('image/png')
    const idx = buildBookIndex(doc, { skip: DEFAULT_SKIP, dictionary: [] })
    const spoken = idx.sentences.map((s) => s.spoken.text)
    expect(spoken.some((t) => t.includes('I shall be late!”'))).toBe(true)
    // the noteref "1" is not read
    expect(spoken.some((t) => /late!”\s*1/.test(t))).toBe(false)
  })
})
