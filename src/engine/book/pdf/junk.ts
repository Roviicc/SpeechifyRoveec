import type { PdfLine } from './layout'

/**
 * Smart-skip classification of PDF lines that interrupt the reading flow: footnotes, tables and
 * figure/table captions. Lines are only marked (role / block skip), never removed, so Original mode
 * can still map and grey them. Every rule is deliberately conservative: reading a footnote is
 * better than silently skipping a paragraph of prose.
 */

/** Footnote lines are at most this fraction of the body text height. */
export const FOOTNOTE_MAX_HEIGHT = 0.88
/** Footnotes may cover at most this fraction of a page's lines. */
const FOOTNOTE_MAX_SHARE = 0.4
/** A footnote zone starts with a note marker: "1 …", "12. …", "*…", "†…". */
const NOTE_MARKER = /^(?:\d{1,3}|[*†‡§¶]{1,3})(?=[\s.):\]]|\p{Lu}|\p{Ll}{2})/u

const overlapsX = (a: PdfLine, b: PdfLine) => a.x < b.x + b.width && b.x < a.x + a.width

/**
 * Mark footnotes (role 'footnote'): lines in a noticeably smaller font than the body, below every
 * body-size line in the same horizontal band (so per column on column pages), on a page that also
 * has body text, where the top line of the zone starts with a note marker.
 */
export function markFootnotes(lines: PdfLine[], bodyHeight: number) {
  if (!(bodyHeight > 0)) return
  const body = lines.filter((l) => !l.role)
  const small = (l: PdfLine) => l.h <= bodyHeight * FOOTNOTE_MAX_HEIGHT
  const normal = body.filter((l) => !small(l))
  if (normal.length < 3) return
  const zone = body.filter((l) => small(l) && !normal.some((n) => n.y < l.y - 0.5 && overlapsX(n, l)) && normal.some((n) => n.y > l.y && overlapsX(n, l)))
  if (!zone.length || zone.length > body.length * FOOTNOTE_MAX_SHARE) return
  const marked: PdfLine[] = []
  for (const l of zone) {
    const group = zone.filter((o) => overlapsX(o, l))
    const first = group.reduce((a, b) => (b.y > a.y ? b : a))
    if (NOTE_MARKER.test(first.text.trim())) marked.push(l)
  }
  for (const l of marked) l.role = 'footnote'
}

const NUMBER_CELL = /^[-+−–(]?[$€£¥]?\d[\d,.]*%?\)?[*†]?$|^[-–—]$/
/** Minimum number of consecutive table-like lines before they are skipped as a table. */
export const TABLE_MIN_ROWS = 3

/** True for a line that looks like a table row: mostly numbers, or several short cells separated by wide gaps. */
export function isTableRow(l: PdfLine): boolean {
  const toks = l.text.split(/\s+/).filter(Boolean)
  const nums = toks.filter((t) => NUMBER_CELL.test(t)).length
  if (toks.length >= 2 && nums >= 2 && nums / toks.length >= 0.6) return true
  const bs = l.boxes
  if (!bs || bs.length < 3) return false
  let cells = 1
  for (let k = 1; k < bs.length; k++) if (bs[k][0] - bs[k - 1][1] >= l.h * 1.5) cells++
  return cells >= 3 && l.text.length / cells <= 14
}

/** Mark runs of at least TABLE_MIN_ROWS consecutive table-like lines (role 'table'). */
export function markTables(lines: PdfLine[]) {
  let run: PdfLine[] = []
  const end = () => {
    if (run.length >= TABLE_MIN_ROWS) for (const l of run) l.role = 'table'
    run = []
  }
  for (const l of lines) {
    if (!l.role && isTableRow(l)) run.push(l)
    else end()
  }
  end()
}

// "Figure 3.", "Fig. 2:", "Table 1", "TABLE IV — Results", "Figure 2.1: Overview"
const CAPTION = /^(?:Figure|Fig\.|Table|Tab\.|Chart|Exhibit|Plate|Scheme)\s*(?:\d+(?:[.-]\d+)*[a-z]?|[IVXLC]+)(?:\s*[.:|—–-]\s+\S|\s*[.:]?$)/i
/** Captions longer than this are read (they are likely prose that happens to start with "Figure 2."). */
export const CAPTION_MAX_CHARS = 160

/** A short figure/table caption paragraph. */
export function isCaptionText(text: string): boolean {
  const t = text.trim()
  return t.length <= CAPTION_MAX_CHARS && CAPTION.test(t)
}
