import { describe, expect, it } from 'vitest'
import { remapLocator, remapRange } from '@/engine/book/remap'
import type { BookDoc } from '@/engine/book/types'

const doc = (pages: string[][]): BookDoc => ({
  version: 1,
  type: 'pdf',
  title: 't',
  toc: [],
  sections: pages.map((blocks, i) => ({ title: `Page ${i + 1}`, blocks: blocks.map((text) => ({ text, kind: 'p' as const, page: i })) })),
})

// old parse interleaved two columns; the new one reads them in order and splits off a footnote
const oldDoc = doc([
  ['Cover page title'],
  ['Left one right one', 'Left two right two', '1 A footnote.'],
  ['Last page text here.'],
])
const newDoc = doc([
  ['Cover page title'],
  ['Left one', 'Left two', 'right one', 'right two', '1 A footnote.'],
  ['Last page text here.'],
])

describe('remapLocator', () => {
  it('finds the same text on the same page after a re-parse', () => {
    // "right two" in old block 2 (global), offset 9
    expect(remapLocator(oldDoc, newDoc, { section: 1, block: 2, offset: 9 })).toEqual({ section: 1, block: 4, offset: 0 })
    expect(remapLocator(oldDoc, newDoc, { section: 1, block: 1, offset: 0 })).toEqual({ section: 1, block: 1, offset: 0 })
    expect(remapLocator(oldDoc, newDoc, { section: 1, block: 3, offset: 2 })).toEqual({ section: 1, block: 5, offset: 2 })
    // later pages shift by the number of new blocks before them
    expect(remapLocator(oldDoc, newDoc, { section: 2, block: 4, offset: 5 })).toEqual({ section: 2, block: 6, offset: 5 })
  })

  it('falls back to the start of the same page', () => {
    const other = doc([['Cover page title'], ['Completely different words'], ['Last page text here.']])
    expect(remapLocator(oldDoc, other, { section: 1, block: 1, offset: 3 })).toEqual({ section: 1, block: 1, offset: 0 })
    // a locator that does not point into its section is not trusted
    expect(remapLocator(oldDoc, newDoc, { section: 2, block: 1, offset: 0 })).toEqual({ section: 2, block: 6, offset: 0 })
  })

  it('maps highlight ranges using the highlighted text', () => {
    const r = remapRange(oldDoc, newDoc, { section: 1, block: 2, offset: 0 }, { section: 1, block: 2, offset: 8 }, 'Left two')
    expect(r).toEqual({ start: { section: 1, block: 2, offset: 0 }, end: { section: 1, block: 2, offset: 8 } })
  })
})
