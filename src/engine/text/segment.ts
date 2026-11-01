import type { Span } from './types'

/** Abbreviations that end in a period but rarely end a sentence. */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'mx', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'ft', 'vs', 'etc', 'e.g', 'i.e', 'cf', 'al',
  'fig', 'figs', 'no', 'nos', 'vol', 'vols', 'pp', 'p', 'ch', 'chap', 'sec', 'inc', 'ltd', 'co', 'corp', 'dept',
  'est', 'gen', 'gov', 'lt', 'col', 'capt', 'cmdr', 'sgt', 'rev', 'hon', 'approx', 'jan', 'feb', 'mar', 'apr',
  'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'u.s', 'u.k', 'a.m', 'p.m', 'ed', 'eds', 'op', 'ibid',
  'viz', 'resp', 'eq', 'eqs', 'ca', 'c',
])

let sentenceSegmenter: Intl.Segmenter | null = null
function segmenter(): Intl.Segmenter {
  sentenceSegmenter ??= new Intl.Segmenter('en', { granularity: 'sentence' })
  return sentenceSegmenter
}

function trimSpan(text: string, start: number, end: number): Span | null {
  while (start < end && /\s/.test(text[start])) start++
  while (end > start && /\s/.test(text[end - 1])) end--
  return end > start ? { start, end } : null
}

/** True if the sentence ends with an abbreviation/initial and should be glued to the next one. */
function endsWithAbbreviation(text: string, span: Span): boolean {
  const s = text.slice(span.start, span.end)
  if (!s.endsWith('.')) return false
  const m = /(?:^|[\s(“"'‘])([A-Za-z][A-Za-z.]*)\.$/.exec(s)
  if (!m) return false
  const word = m[1].toLowerCase()
  if (ABBREVIATIONS.has(word)) return true
  // Single capital initial like "J." in "J. R. R. Tolkien"
  return /^[A-Z]$/.test(m[1])
}

/** Split a too-long span at the best natural break before `maxLen`. */
function splitLong(text: string, span: Span, maxLen: number): Span[] {
  const out: Span[] = []
  let { start } = span
  const { end } = span
  while (end - start > maxLen) {
    const window = text.slice(start, start + maxLen)
    let cut = -1
    for (const re of [/[;:]\s/g, /[,–—]\s/g, /\s[–—-]\s/g, /\s/g]) {
      let m: RegExpExecArray | null
      let last = -1
      re.lastIndex = 0
      while ((m = re.exec(window))) {
        // don't produce tiny fragments
        if (m.index > maxLen * 0.3) last = m.index + m[0].length
      }
      if (last > 0) {
        cut = last
        break
      }
    }
    if (cut <= 0) cut = maxLen
    const piece = trimSpan(text, start, start + cut)
    if (piece) out.push(piece)
    start += cut
  }
  const rest = trimSpan(text, start, end)
  if (rest) out.push(rest)
  return out
}

/** Split a block of text into sentence spans (offsets into `text`), each <= maxLen chars. */
export function splitSentences(text: string, maxLen = 400): Span[] {
  const raw: Span[] = []
  for (const seg of segmenter().segment(text)) {
    const span = trimSpan(text, seg.index, seg.index + seg.segment.length)
    if (span) raw.push(span)
  }
  const merged: Span[] = []
  for (const span of raw) {
    const prev = merged[merged.length - 1]
    const body = text.slice(span.start, span.end)
    const startsLower = /^[a-z]/.test(body)
    const onlyPunct = !/[\p{L}\p{N}]/u.test(body)
    if (prev && (endsWithAbbreviation(text, prev) || startsLower || onlyPunct)) {
      prev.end = span.end
    } else {
      merged.push({ ...span })
    }
  }
  return merged.flatMap((s) => (s.end - s.start > maxLen ? splitLong(text, s, maxLen) : [s]))
}

let wordSegmenter: Intl.Segmenter | null = null
/** Word-like segments of `text` within [start, end), as absolute spans. */
export function splitWords(text: string, start = 0, end = text.length): Span[] {
  wordSegmenter ??= new Intl.Segmenter('en', { granularity: 'word' })
  const out: Span[] = []
  const sub = text.slice(start, end)
  for (const seg of wordSegmenter.segment(sub)) {
    if (seg.isWordLike) out.push({ start: start + seg.index, end: start + seg.index + seg.segment.length })
  }
  return out
}
