import type { BookIndex } from '@/engine/book/bookIndex'
import type { TocEntry } from '@/engine/book/types'
import { tocRanges } from '@/engine/book/tocRanges'

/** A pack never holds more sentences than this (~1.5 h of speech, ~15 MB of Opus); longer chapters are split. */
export const MAX_PACK_SENTENCES = 1500
/** Chunk size for books without a table of contents. */
const NO_TOC_CHUNK = 300

export interface PackRange {
  from: number
  to: number
}

function split(from: number, to: number, size: number, out: PackRange[]) {
  for (let a = from; a <= to; a += size) out.push({ from: a, to: Math.min(to, a + size - 1) })
}

/**
 * How a book's sentences are cut into packs: one per top-level Contents chapter (what the Prepare buttons work on),
 * the text before the first chapter joined to it, very long chapters split. Both devices compute the same ranges
 * for the same book and settings; downloads match packs to chapters by overlap, so different ranges still work.
 */
export function packRanges(toc: TocEntry[], index: BookIndex): PackRange[] {
  const count = index.sentences.length
  if (!count) return []
  const out: PackRange[] = []
  const tops = tocRanges(toc, index)
    .filter((r, i) => toc[i].level === 0 && r.end >= r.start)
    .sort((a, b) => a.start - b.start)
  if (!tops.length) {
    split(0, count - 1, NO_TOC_CHUNK, out)
    return out
  }
  let next = 0
  tops.forEach((r, k) => {
    const from = k === 0 ? 0 : Math.max(next, r.start)
    // a chapter runs to the next one (gaps, if any, go with the chapter before)
    const to = k + 1 < tops.length ? tops[k + 1].start - 1 : count - 1
    if (to < from) return
    split(from, to, MAX_PACK_SENTENCES, out)
    next = to + 1
  })
  return out
}
