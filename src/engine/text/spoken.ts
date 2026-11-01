import { splitWords } from './segment'
import type { Replacement, Span } from './types'

export interface SpokenWord extends Span {
  /** relative share of the sentence's audio (unnormalised) */
  weight: number
}

export interface SpokenText {
  /** text sent to the voice */
  text: string
  /** display-text words (absolute offsets in the block) that are actually read */
  words: SpokenWord[]
  /** weight of leading silence + all words + trailing silence */
  totalWeight: number
  /** weight before the first word (model's leading silence) */
  leadWeight: number
}

const LEAD = 2
const TAIL = 4
const PAUSE: Record<string, number> = { ',': 3, ';': 4, ':': 4, '—': 3, '–': 3, '.': 6, '!': 6, '?': 6, '…': 6 }

/** Drop overlapping replacements, keeping the earliest (then longest). */
export function resolveOverlaps(reps: Replacement[]): Replacement[] {
  const sorted = [...reps].sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))
  const out: Replacement[] = []
  let lastEnd = -1
  for (const r of sorted) {
    if (r.start >= lastEnd) {
      out.push(r)
      lastEnd = r.end
    }
  }
  return out
}

/**
 * Turn the display text of one sentence ([start, end) of `blockText`) into the text sent to
 * the voice, plus per-word weights used to estimate word timing.
 * `replacements` must already be overlap-free and sorted (see resolveOverlaps).
 */
export function buildSpoken(blockText: string, start: number, end: number, replacements: Replacement[]): SpokenText {
  const len = end - start
  const charWeight = new Float32Array(len).fill(1)
  let text = ''
  let pos = start
  for (const r of replacements) {
    if (r.end <= start || r.start >= end) continue
    const rs = Math.max(r.start, start)
    const re = Math.min(r.end, end)
    if (rs < pos) continue
    text += blockText.slice(pos, rs)
    if (r.say) {
      text += (text && !/\s$/.test(text) ? ' ' : '') + r.say + ' '
      const w = r.say.length / (re - rs)
      for (let i = rs; i < re; i++) charWeight[i - start] = w
    } else {
      text += ' '
      for (let i = rs; i < re; i++) charWeight[i - start] = 0
    }
    pos = re
  }
  text += blockText.slice(pos, end)
  text = text.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim()
  if (!/[\p{L}\p{N}]/u.test(text)) text = ''

  const words: SpokenWord[] = []
  if (text) {
    const all = splitWords(blockText, start, end)
    for (let wi = 0; wi < all.length; wi++) {
      const w = all[wi]
      let weight = 0
      for (let i = w.start; i < w.end; i++) weight += charWeight[i - start]
      if (weight <= 0) continue
      // punctuation pause between this word and the next one
      const gapEnd = wi + 1 < all.length ? all[wi + 1].start : end
      let pause = 1
      for (let i = w.end; i < gapEnd; i++) {
        if (charWeight[i - start] === 0) continue
        pause = Math.max(pause, PAUSE[blockText[i]] ?? 1)
      }
      words.push({ start: w.start, end: w.end, weight: weight + pause })
    }
  }
  const sum = words.reduce((a, w) => a + w.weight, 0)
  return { text, words, totalWeight: sum + LEAD + TAIL, leadWeight: LEAD }
}
