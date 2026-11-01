import type { Replacement, SkipOptions } from './types'

const SUPERSCRIPTS = '⁰¹²³⁴⁵⁶⁷⁸⁹'

// [12], [3-5], [1, 4, 7], [12a]
const BRACKET_CITATION = /\[\s*\d{1,4}[a-z]?(?:\s*[-–,]\s*\d{1,4}[a-z]?)*\s*\]/g
// (Smith, 2020), (Smith & Jones 2019; Lee et al., 2021, p. 4), (Smith 2020a)
// but not dates such as "(March 2020)", "(Summer 2019)" or "(Since 1990)"
const NOT_AUTHOR =
  '(?!(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec|Spring|Summer|Autumn|Fall|Winter|Since|Until|Till|Before|After|From|In|By|Circa|Early|Late|Mid)\\.?,?\\s)'
const AUTHOR_YEAR = new RegExp(
  String.raw`\((?:see |cf\. |e\.g\., )?${NOT_AUTHOR}[A-Z][\p{L}'’-]+(?:\s(?:et al\.|and|&)\s?[A-Z]?[\p{L}'’-]*)*,?\s(?:1[6-9]|20)\d{2}[a-z]?(?:,\s*pp?\.\s*\d+(?:[-–]\d+)?)?(?:;\s*[A-Z][\p{L}'’-]+(?:\s(?:et al\.|and|&)\s?[A-Z]?[\p{L}'’-]*)*,?\s(?:1[6-9]|20)\d{2}[a-z]?(?:,\s*pp?\.\s*\d+(?:[-–]\d+)?)?)*\)`,
  'gu',
)
// URLs and bare www. addresses (trailing punctuation trimmed below)
const URL = /\b(?:https?:\/\/|www\.)[^\s<>"“”]+/gi
// Unicode superscript digits and footnote symbols directly after a word/punctuation —
// but not exponents: after a digit ("10²") or a one/two-letter symbol or unit ("m²", "mc²", "km²")
const SUPERSCRIPT_MARK = new RegExp(
  `(?<!\\p{N}|(?:^|[^\\p{L}])\\p{L}{1,2})[${SUPERSCRIPTS}]+|(?<=[\\p{L}.,;:!?”’"')])[*†‡§]+`,
  'gu',
)
// abbreviations that are followed by a number: "p.12", "No.5", "vol.3"
const NUMBERED_ABBR = ['p', 'pp', 'no', 'nos', 'vol', 'vols', 'fig', 'figs', 'ch', 'chap', 'sec', 'eq', 'eqs', 'op', 'art', 'ref', 'tab', 'v']
  .flatMap((w) => [w, w[0].toUpperCase() + w.slice(1)])
  .join('|')
// "...end of a sentence.12 Next" — digits glued after sentence punctuation
const GLUED_NUMBER = new RegExp(`(?<=[\\p{Ll}][.,;:!?”’"')])(?<!(?:^|[^\\p{L}])(?:${NUMBERED_ABBR})\\.)\\d{1,3}(?=\\s|$)`, 'gu')

/** Inline replacements (skip / say-as) for citations, footnote markers and URLs. */
export function findInlineSkips(
  text: string,
  opts: SkipOptions,
  markedFootnotes: Array<[number, number]> = [],
): Replacement[] {
  const out: Replacement[] = []
  const add = (re: RegExp, kind: Replacement['kind'], say: string) => {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      let start = m.index
      let end = m.index + m[0].length
      if (kind === 'url') {
        while (end > start && /[.,;:!?)\]}'"”’]/.test(text[end - 1])) end--
      }
      // swallow one space before a skipped citation so "word [12]." reads cleanly
      if (say === '' && kind === 'citation' && start > 0 && text[start - 1] === ' ') start--
      out.push({ start, end, say, kind })
    }
  }
  if (opts.citations) {
    add(BRACKET_CITATION, 'citation', '')
    add(AUTHOR_YEAR, 'citation', '')
  }
  if (opts.footnotes) {
    add(SUPERSCRIPT_MARK, 'footnote', '')
    add(GLUED_NUMBER, 'footnote', '')
    for (const [start, end] of markedFootnotes) out.push({ start, end, say: '', kind: 'footnote' })
  }
  if (opts.urls) add(URL, 'url', 'link')
  return out
}

/** A line/block that is just a page number: "12", "- 12 -", "Page 3", "3 of 10", "xiv". */
export function isPageNumberLine(text: string): boolean {
  const t = text.trim()
  if (!t || t.length > 20) return false
  return (
    /^[-–—\s]*(?:page\s+)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?[-–—\s]*$/i.test(t) ||
    /^(?=[ivxlcdm]+$)m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/i.test(t)
  )
}

/** Normalise a header/footer candidate so "Chapter 2 · 14" and "Chapter 2 · 15" match. */
export function normalizeRepeatLine(text: string): string {
  return text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()
}
