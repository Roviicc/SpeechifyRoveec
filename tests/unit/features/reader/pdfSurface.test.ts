import { describe, expect, it } from 'vitest'
import { buildBookIndex } from '@/engine/book/bookIndex'
import { groupLines, linesToBlocks, type PdfTextItem } from '@/engine/book/pdf/layout'
import { DEFAULT_SKIP } from '@/engine/text/types'
import { PdfSurface } from '@/features/reader/highlight/surface'

describe('PdfSurface', () => {
  const item = (str: string, x: number, y: number): PdfTextItem => ({ str, transform: [10, 0, 0, 10, x, y], width: str.length * 5, height: 10 })
  const items = [item('First one ends here. Second ', 0, 100), item('starts here and ends.', 0, 88)]
  const blocks = linesToBlocks(groupLines(items), 0)
  const index = buildBookIndex({ version: 1, type: 'pdf', title: 'T', toc: [], sections: [{ title: 'p', blocks }] }, { skip: DEFAULT_SKIP, dictionary: [] })

  function mount() {
    const page = document.createElement('div')
    page.dataset.page = '0'
    const divs = items.map((it, i) => {
      const d = document.createElement('span')
      d.dataset.i = String(i)
      d.textContent = it.str
      page.append(d)
      return d
    })
    document.body.append(page)
    const surface = new PdfSurface(index.blocks)
    surface.pages.set(0, divs)
    return { surface, divs }
  }

  it('maps text-layer positions to block offsets and back', () => {
    const { surface, divs } = mount()
    const text = index.blocks[0].text
    expect(surface.locate(divs[1].firstChild!, 7)).toEqual({ block: 0, offset: text.indexOf('starts') + 7 })
    const r = surface.rangesFor(0, text.indexOf('Second'), text.indexOf('Second') + 6)
    expect(r.map((x) => x.toString())).toEqual(['Second'])
  })

  it('a tap on trailing whitespace of an item maps to its end, not its start', () => {
    const { surface, divs } = mount()
    const text = index.blocks[0].text
    const p = surface.locate(divs[0].firstChild!, items[0].str.length)!
    expect(p.offset).toBe(text.indexOf('Second') + 'Second'.length)
  })
})
