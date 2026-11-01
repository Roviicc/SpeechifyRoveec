import type { BookIndex } from '@/engine/book/bookIndex'
import type { Locator } from '@/data/db'

/** Stable locator of sentence `i`, or null when it doesn't exist. */
export function locatorOf(idx: BookIndex | null, i: number): Locator | null {
  const s = idx?.sentences[i]
  if (!s) return null
  return { section: s.section, block: s.block, offset: s.start }
}

/** True when section `s` has sentences of its own (an empty section shares its start with the next one). */
function hasSentences(idx: BookIndex, s: number): boolean {
  const start = idx.sectionSentenceStart[s]
  return start < idx.sentences.length && idx.sentences[start].section === s
}

/**
 * Sentence to jump to for "next / previous section" from sentence `current`, or null to stay put.
 * Backwards works like "previous track": first back to the start of the current section.
 */
export function sectionJumpTarget(idx: BookIndex, current: number, dir: 1 | -1): number | null {
  const cur = idx.sentences[current]?.section ?? 0
  const starts = idx.sectionSentenceStart
  if (dir === 1) {
    for (let s = cur + 1; s < starts.length; s++) if (hasSentences(idx, s)) return starts[s]
    return null
  }
  if (current > starts[cur] + 1) return starts[cur]
  for (let s = cur - 1; s >= 0; s--) if (hasSentences(idx, s)) return starts[s]
  return null
}
