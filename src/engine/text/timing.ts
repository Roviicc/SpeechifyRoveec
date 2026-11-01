import type { SpokenText } from './spoken'
import type { Span } from './types'

export interface WordTiming extends Span {
  t0: number
  t1: number
}

/** Distribute `duration` seconds over the words by their weight (monotonic, sums to <= duration). */
export function wordTimings(sp: SpokenText, duration: number): WordTiming[] {
  if (!sp.words.length || duration <= 0) return []
  const k = duration / sp.totalWeight
  let t = sp.leadWeight * k
  return sp.words.map((w) => {
    const t0 = t
    t += w.weight * k
    return { start: w.start, end: w.end, t0, t1: t }
  })
}

/** Index of the word playing at time `t` (seconds), or -1 before the first word. */
export function wordIndexAt(timings: WordTiming[], t: number): number {
  let lo = 0
  let hi = timings.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (timings[mid].t0 <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

/** Index of the word containing (or nearest after) character offset `offset`. */
export function wordIndexAtOffset(words: Span[], offset: number): number {
  for (let i = 0; i < words.length; i++) if (offset < words[i].end) return i
  return words.length - 1
}
