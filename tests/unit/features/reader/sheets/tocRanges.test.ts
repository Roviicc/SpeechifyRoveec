import { describe, expect, it } from 'vitest'
import { buildBookIndex } from '@/engine/book/bookIndex'
import type { BookDoc } from '@/engine/book/types'
import { tocRanges } from '@/features/reader/sheets/tocRanges'
import { DEFAULT_SKIP as SKIP } from '@/engine/text/types'

const p = (text: string) => ({ text, kind: 'p' as const })
const doc: BookDoc = {
  version: 1,
  type: 'epub',
  title: 'T',
  sections: [
    { title: 'A', blocks: [p('One. Two.'), p('Three.')] },
    { title: 'B', blocks: [p('Four.'), p('Five. Six.')] },
  ],
  toc: [
    { title: 'A', section: 0, level: 0 },
    { title: 'B', section: 1, level: 0 },
    { title: 'B.1', section: 1, block: 1, level: 1 },
  ],
}

describe('tocRanges', () => {
  it('spans each entry to the next entry at the same or a higher level', () => {
    const index = buildBookIndex(doc, { skip: SKIP, dictionary: [] })
    expect(index.sentences).toHaveLength(6)
    const r = tocRanges(doc.toc, index)
    expect(r[0]).toEqual({ block: 0, start: 0, end: 2 })
    expect(r[1]).toEqual({ block: 2, start: 3, end: 5 })
    expect(r[2]).toEqual({ block: 3, start: 4, end: 5 })
  })
})
