import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { BlockView } from '@/features/reader/views/blockContent'
import { ReflowSurface, textNodes } from '@/features/reader/highlight/surface'
import type { FlatBlock } from '@/engine/book/bookIndex'
import type { Block } from '@/engine/book/types'

const flat = (b: Block, index: number): FlatBlock => ({ ...b, index, section: 0, skipped: [], skippedAll: false })

function mount(blocks: Block[]) {
  const root = document.createElement('div')
  root.innerHTML = blocks.map((b, i) => renderToStaticMarkup(createElement(BlockView, { b: flat(b, i) }))).join('')
  document.body.appendChild(root)
  return { root, surface: new ReflowSurface(root) }
}

afterEach(() => {
  document.body.innerHTML = ''
})

const italic: Block = {
  text: 'So she was very sleepy and stupid, when a Rabbit ran by.',
  kind: 'p',
  marks: [
    [16, 22, 'i'],
    [23, 33, 'b'],
    [27, 33, 'i'],
  ],
}
const row: Block = { text: 'Thimble; Alice', kind: 'p', cells: [[0, 7], [9, 14]], marks: [[9, 14, 'i']] }
const plain: Block = { text: 'Plain text block.', kind: 'p' }
const img: Block = { text: '', kind: 'img', src: 'OEBPS/images/a.png', alt: 'A', w: 10, h: 5 }

describe('ReflowSurface across multiple text nodes', () => {
  it('renders blocks whose textContent equals the block text', () => {
    const { root } = mount([italic, row, plain, img])
    const els = root.querySelectorAll<HTMLElement>('[data-b]')
    expect([...els].map((e) => e.textContent)).toEqual([italic.text, row.text, plain.text, ''])
    expect(textNodes(els[0]).length).toBeGreaterThan(3)
    expect(els[0].querySelectorAll('.m-i')).toHaveLength(2)
    expect(els[1].querySelector('.cell-sep')?.textContent).toBe('; ')
  })

  it('maps block offsets to ranges for every [start, end) in a formatted block', () => {
    const { surface } = mount([italic, row, plain])
    for (const b of [0, 1]) {
      const text = [italic, row][b].text
      for (let s = 0; s <= text.length; s++) {
        for (let e = s; e <= text.length; e += 3) {
          const [r] = surface.rangesFor(b, s, e)
          expect(r.toString()).toBe(text.slice(s, e))
        }
      }
    }
    expect(surface.rangesFor(2, 6, 10)[0].toString()).toBe('text')
    // out of range offsets are clamped
    expect(surface.rangesFor(2, 6, 999)[0].toString()).toBe('text block.')
  })

  it('locates DOM points back to block offsets (round trip)', () => {
    const { root, surface } = mount([italic, row, img])
    for (const b of [0, 1]) {
      const el = root.querySelector<HTMLElement>(`[data-b="${b}"]`)!
      let pos = 0
      for (const n of textNodes(el)) {
        for (let o = 0; o <= n.length; o++) expect(surface.locate(n, o)).toEqual({ block: b, offset: pos + o })
        pos += n.length
      }
    }
    // element boundaries resolve through toTextBoundary
    const el0 = root.querySelector('[data-b="0"]')!
    const italicSpan = el0.querySelector('.m-i')!
    expect(surface.locate(italicSpan, 0)).toEqual({ block: 0, offset: 16 })
    // a range's own boundaries map back to the same offsets
    const [r] = surface.rangesFor(0, 18, 30)
    expect(surface.locate(r.startContainer, r.startOffset)).toEqual({ block: 0, offset: 18 })
    expect(surface.locate(r.endContainer, r.endOffset)).toEqual({ block: 0, offset: 30 })
    // images have no text: nothing to locate or highlight
    const fig = root.querySelector('[data-b="2"]')!
    expect(surface.locate(fig, 0)).toBeNull()
    expect(surface.rangesFor(2, 0, 0)).toEqual([])
  })
})

describe('look up', () => {
  it('builds dictionary links and the ColorDict intent', async () => {
    const { cleanQuery, colorDictIntent, lookupUrl } = await import('@/features/reader/lookup')
    expect(cleanQuery('  “Serendipity,”  ')).toBe('Serendipity')
    expect(lookupUrl('merriam', 'walkable city')).toBe('https://www.merriam-webster.com/dictionary/walkable%20city')
    expect(lookupUrl('wiktionary', 'Walkable City')).toBe('https://en.wiktionary.org/wiki/walkable_city')
    expect(lookupUrl('share', 'x')).toBeNull()
    expect(colorDictIntent('pedestrian')).toContain('action=colordict.intent.action.SEARCH;package=com.socialnmobile.colordict;S.EXTRA_QUERY=pedestrian;')
  })
})

describe('android app helper', () => {
  it('builds intent URLs for the native helper', async () => {
    const { nativeHelperUrl } = await import('@/features/reader/lookup')
    expect(nativeHelperUrl('lookup', 'walk able')).toBe('intent://lookup?q=walk%20able#Intent;scheme=lumen;package=app.lumen.reader;end')
    expect(nativeHelperUrl('choose')).toBe('intent://choose#Intent;scheme=lumen;package=app.lumen.reader;end')
  })
})
