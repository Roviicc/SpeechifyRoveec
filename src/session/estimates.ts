import { sectionEndSentence, type BookIndex } from '@/engine/book/bookIndex'

/** Starting guess for seconds of audio per spoken character at 1x. */
export const DEFAULT_SECONDS_PER_CHAR = 0.068

export interface TimeEstimate {
  elapsed: number
  total: number
  sectionRemaining: number
}

/**
 * Elapsed / total / rest-of-section seconds at the current speed.
 * `within` is how far (0..1) the current sentence has played.
 */
export function estimateTimes(idx: BookIndex | null, i: number, within: number, secondsPerChar: number, speed: number): TimeEstimate {
  if (!idx || !idx.sentences.length) return { elapsed: 0, total: 0, sectionRemaining: 0 }
  const k = secondsPerChar / speed
  const elapsedChars = idx.cumChars[i] + idx.sentences[i].chars * within
  const end = sectionEndSentence(idx, idx.sentences[i].section)
  return {
    elapsed: elapsedChars * k,
    total: idx.totalChars * k,
    sectionRemaining: Math.max(0, idx.cumChars[end + 1] - elapsedChars) * k,
  }
}

/** Fraction (0..1) of the current sentence already played. */
export function playedFraction(currentTime: number, duration: number | null): number {
  return duration ? Math.min(1, currentTime / duration) : 0
}

/** Map a fraction of the book (0..1) to a sentence index. */
export function sentenceAtFraction(idx: BookIndex | null, f: number): number {
  if (!idx) return 0
  const target = f * idx.totalChars
  let lo = 0
  let hi = idx.sentences.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (idx.cumChars[mid] <= target) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Blend a freshly generated sentence into the seconds-per-character average (short sentences are too noisy). */
export function refineSecondsPerChar(current: number, duration: number, chars: number): number {
  if (!(duration > 0) || chars <= 20) return current
  return current * 0.9 + (duration / chars) * 0.1
}
