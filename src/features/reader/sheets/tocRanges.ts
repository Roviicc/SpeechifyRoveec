import type { BookIndex } from '@/engine/book/bookIndex'
import type { TocEntry } from '@/engine/book/types'

export interface TocRange {
  /** first global block of the entry */
  block: number
  /** first and last sentence (end < start when the entry has nothing to read) */
  start: number
  end: number
}

/** First sentence whose block is >= `block` (sentences are ordered by block). */
function firstSentenceAt(index: BookIndex, block: number): number {
  const s = index.sentences
  let lo = 0
  let hi = s.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (s[mid].block < block) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Sentence range of every TOC entry: from its start to the next entry at the same or a higher level. */
export function tocRanges(toc: TocEntry[], index: BookIndex): TocRange[] {
  const blocks = toc.map((t) => (index.sectionBlockStart[t.section] ?? 0) + (t.block ?? 0))
  const starts = blocks.map((b) => firstSentenceAt(index, b))
  return toc.map((t, i) => {
    let j = i + 1
    while (j < toc.length && toc[j].level > t.level) j++
    const end = (j < toc.length ? starts[j] : index.sentences.length) - 1
    return { block: blocks[i], start: starts[i], end }
  })
}
