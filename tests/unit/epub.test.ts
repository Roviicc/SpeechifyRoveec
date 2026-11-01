import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractBlocks, imageSize, parseEpub, resolvePath } from '../../src/engine/doc/epub'
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

const body = (html: string) =>
  new DOMParser()
    .parseFromString(`<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:xlink="http://www.w3.org/1999/xlink"><body>${html}</body></html>`, 'application/xhtml+xml')
    .getElementsByTagName('body')[0]

describe('EPUB rich structure', () => {
  it('keeps inline formatting as marks over the unchanged text', () => {
    const [b] = extractBlocks(body('<p>A <i>very</i> <b>bold <em>and italic</em></b> word<sup>2</sup>, <span class="smallcaps">Small Caps</span> and <code>x = 1</code>.</p>'))
    expect(b.text).toBe('A very bold and italic word2, Small Caps and x = 1.')
    const at = (k: string) => b.marks!.filter((m) => m[2] === k).map(([s, e]) => b.text.slice(s, e))
    expect(at('i')).toEqual(['very', 'and italic'])
    expect(at('b')).toEqual(['bold and italic'])
    expect(at('sup')).toEqual(['2'])
    expect(at('sc')).toEqual(['Small Caps'])
    expect(at('code')).toEqual(['x = 1'])
    expect(b.marks!.map((m) => m[0])).toEqual([...b.marks!.map((m) => m[0])].sort((x, y) => x - y))
  })

  it('extracts images as unread blocks with resolved zip paths', () => {
    const blocks = extractBlocks(
      body(`<p>Before.</p><p><img src="../images/a%20b.png" alt="A picture" width="300" height="200"/></p>
        <p>Inline <img src="dot.gif"/> image keeps the sentence whole.</p>
        <svg viewBox="0 0 10 10"><title>Vector cover</title><image xlink:href="../images/cover.jpg"/></svg>
        <p><img src="https://example.org/remote.png"/>After.</p>`),
      { base: 'OEBPS/text/ch1.xhtml' },
    )
    expect(blocks.map((b) => [b.kind, b.text || b.src])).toEqual([
      ['p', 'Before.'],
      ['img', 'OEBPS/images/a b.png'],
      ['p', 'Inline image keeps the sentence whole.'],
      ['img', 'OEBPS/text/dot.gif'],
      ['img', 'OEBPS/images/cover.jpg'],
      ['p', 'After.'],
    ])
    expect(blocks[1]).toMatchObject({ alt: 'A picture', w: 300, h: 200, text: '' })
    expect(blocks[4].alt).toBe('Vector cover')
    // images are never read: no sentences point at them
    const idx = buildBookIndex({ version: 1, type: 'epub', title: 't', toc: [], sections: [{ title: 's', blocks }] }, { skip: DEFAULT_SKIP, dictionary: [] })
    expect(idx.sentences.every((s) => idx.blocks[s.block].kind !== 'img')).toBe(true)
    expect(idx.sentences).toHaveLength(3)
  })

  it('keeps blockquotes, lists, line breaks, pre, tables and heading levels', () => {
    const blocks = extractBlocks(
      body(`<h1>Book</h1><h2>Part</h2><h4>Small</h4>
        <blockquote><p>Quoted words.</p></blockquote>
        <ol start="3"><li>Third</li><li>Fourth <ul><li>nested</li></ul></li></ol>
        <ul style="list-style: none"><li>plain</li></ul>
        <p class="poem">Line one,<br/>line two,<br/><br/><br/>new stanza.</p>
        <pre>  code()
    indented</pre>
        <table><tr><th>Name</th><th></th><th>Age</th></tr><tr><td>Ann <i>B.</i></td><td>Lee</td></tr></table>`),
    )
    const pick = (t: string) => blocks.find((b) => b.text === t)!
    expect([pick('Book').level, pick('Part').level, pick('Small').level]).toEqual([1, 2, 3])
    expect(pick('Quoted words.')).toMatchObject({ quote: true, indent: 1 })
    expect(pick('Third')).toMatchObject({ li: '3.', indent: 1 })
    expect(pick('Fourth')).toMatchObject({ li: '4.', indent: 1 })
    expect(pick('nested')).toMatchObject({ li: '◦', indent: 2 })
    expect(pick('plain').li).toBeUndefined()
    const poem = blocks.find((b) => b.text.startsWith('Line one'))!
    expect(poem.text).toBe('Line one,\nline two,\n\nnew stanza.')
    expect(poem.pre).toBe('br')
    const pre = blocks.find((b) => b.text.includes('code()'))!
    expect(pre.text).toBe('  code()\n    indented')
    expect(pre.pre).toBe('pre')
    const head = pick('Name; Age')
    expect(head.cells!.map(([s, e]) => head.text.slice(s, e))).toEqual(['Name', 'Age'])
    expect(head.marks!.filter((m) => m[2] === 'b')).toHaveLength(2)
    const row = pick('Ann B.; Lee')
    expect(row.cells).toEqual([[0, 6], [8, 11]])
    expect(row.marks).toEqual([[4, 6, 'i']])
    // lowercase continuation lines stay in one sentence; spoken text has no line breaks
    const idx = buildBookIndex({ version: 1, type: 'epub', title: 't', toc: [], sections: [{ title: 's', blocks: [poem] }] }, { skip: DEFAULT_SKIP, dictionary: [] })
    expect(idx.sentences.map((s) => s.spoken.text)).toEqual(['Line one, line two, new stanza.'])
  })

  it('reads image sizes from headers', () => {
    const png = new Uint8Array(32)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 0x58, 0, 0, 1, 0x90])
    expect(imageSize(png)).toEqual({ w: 600, h: 400 })
    const gif = new Uint8Array(32)
    gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 10, 0, 20, 0])
    expect(imageSize(gif)).toEqual({ w: 10, h: 20 })
    expect(imageSize(new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"></svg>'))).toEqual({ w: 120, h: 80 })
    expect(imageSize(new Uint8Array(30))).toBeNull()
  })

  it('parses fixture images, marks and structure', async () => {
    const { doc } = await parseEpub(readFileSync('tests/fixtures/alice.epub'))
    const all = doc.sections.flatMap((s) => s.blocks)
    expect(all.filter((b) => b.kind === 'img').map((b) => [b.src, b.w, b.h])).toEqual([
      ['OEBPS/images/rabbit.png', 600, 400],
      ['OEBPS/images/pool.png', 600, 360],
    ])
    const sleepy = all.find((b) => b.text.startsWith('So she was considering'))!
    expect(sleepy.marks!.map(([s, e, k]) => [sleepy.text.slice(s, e), k])).toEqual([
      ['sleepy', 'i'],
      ['stupid', 'i'],
    ])
    expect(all.some((b) => b.quote)).toBe(true)
    expect(all.filter((b) => b.li).map((b) => b.li)).toEqual(['1.', '2.', '3.', '•', '•'])
    expect(all.find((b) => b.pre === 'br')?.text.split('\n')).toHaveLength(4)
    expect(all.filter((b) => b.cells)).toHaveLength(3)
    expect(all.find((b) => b.caption)?.text).toBe('The White Rabbit, late as usual.')
  })
})
