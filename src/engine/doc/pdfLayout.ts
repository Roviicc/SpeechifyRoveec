import type { Block, PdfSpan } from './types'
import { isPageNumberLine, normalizeRepeatLine } from '../text/smartSkip'

/** Minimal shape of a pdf.js TextItem. */
export interface PdfTextItem {
  str: string
  transform: number[]
  width: number
  height: number
  hasEOL?: boolean
}

export interface PdfLine {
  text: string
  x: number
  y: number
  h: number
  width: number
  /** [itemIndex, lineOffset, itemOffset, length] */
  spans: PdfSpan[]
  role?: 'header' | 'footer' | 'pagenum'
}

/** Group a page's text items into visual lines (keeps content-stream order). */
export function groupLines(items: PdfTextItem[]): PdfLine[] {
  const lines: PdfLine[] = []
  let cur: PdfLine | null = null
  let lastEnd = 0
  const close = () => {
    if (cur) {
      const t = cur.text
      const trimmed = t.trimEnd()
      if (trimmed.length !== t.length) {
        cur.text = trimmed
        cur.spans = cur.spans
          .map(([i, lo, io, len]) => [i, lo, io, Math.min(len, trimmed.length - lo)] as PdfSpan)
          .filter((s) => s[3] > 0)
      }
      if (/\S/.test(cur.text)) lines.push(cur)
    }
    cur = null
  }
  items.forEach((it, i) => {
    const x = it.transform[4]
    const y = it.transform[5]
    const h = Math.abs(it.height) || Math.hypot(it.transform[2], it.transform[3]) || 10
    if (cur && Math.abs(y - cur.y) > 0.45 * Math.max(h, cur.h)) close()
    if (it.str) {
      if (!cur) {
        cur = { text: '', x, y, h, width: 0, spans: [] }
        lastEnd = x
      } else {
        const gap = x - lastEnd
        if (gap > 0.15 * h && !cur.text.endsWith(' ') && !it.str.startsWith(' ')) cur.text += ' '
      }
      let str = it.str
      let io = 0
      if (!cur.text.length || cur.text.endsWith(' ')) {
        const lead = str.length - str.trimStart().length
        str = str.slice(lead)
        io = lead
      }
      if (str.length) {
        cur.spans.push([i, cur.text.length, io, str.length])
        cur.text += str
      }
      cur.h = Math.max(cur.h, h)
      cur.x = Math.min(cur.x, x)
      lastEnd = x + it.width
      cur.width = Math.max(cur.width, lastEnd - cur.x)
    }
    if (it.hasEOL) close()
  })
  close()
  return lines
}

/**
 * Mark running headers/footers (lines repeated in the top/bottom zone across pages) and
 * standalone page numbers. Mutates `pages` (sets line.role).
 */
export function markRepeatedLines(pages: PdfLine[][]) {
  const zone = 2
  const counts = new Map<string, number>()
  const keyOf = (l: PdfLine, top: boolean) => `${top ? 't' : 'b'}|${normalizeRepeatLine(l.text)}`
  for (const lines of pages) {
    const seen = new Set<string>()
    lines.slice(0, zone).forEach((l) => seen.add(keyOf(l, true)))
    lines.slice(-zone).forEach((l) => seen.add(keyOf(l, false)))
    for (const k of seen) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const minRepeats = Math.max(3, Math.ceil(pages.length * 0.25))
  for (const lines of pages) {
    lines.forEach((l, i) => {
      const top = i < zone
      const bottom = i >= lines.length - zone
      if (!top && !bottom) return
      if (isPageNumberLine(l.text)) {
        l.role = 'pagenum'
        return
      }
      if (pages.length < 3) return
      if (top && (counts.get(keyOf(l, true)) ?? 0) >= minRepeats) l.role = 'header'
      else if (bottom && (counts.get(keyOf(l, false)) ?? 0) >= minRepeats) l.role = 'footer'
    })
  }
}

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[s.length >> 1]
}

/** Assemble lines into paragraphs/headings, de-hyphenating wrapped words. */
export function linesToBlocks(lines: PdfLine[], page: number, bodyHeight?: number): Block[] {
  const body = lines.filter((l) => !l.role)
  const hMed = bodyHeight ?? median(body.map((l) => l.h))
  const gaps: number[] = []
  for (let i = 1; i < body.length; i++) {
    const g = body[i - 1].y - body[i].y
    if (g > 0) gaps.push(g)
  }
  const lineGap = median(gaps) || hMed * 1.2
  const minX = Math.min(...body.map((l) => l.x))
  const maxW = Math.max(...body.map((l) => l.width))

  const blocks: Block[] = []
  let cur: { text: string; spans: PdfSpan[]; kind: Block['kind']; h: number } | null = null
  const flush = () => {
    if (cur && /\S/.test(cur.text)) blocks.push({ text: cur.text, kind: cur.kind, page, spans: cur.spans })
    cur = null
  }
  let prev: PdfLine | null = null
  for (const l of lines) {
    if (l.role) {
      flush()
      blocks.push({ text: l.text, kind: 'p', page, spans: l.spans, skip: l.role })
      continue
    }
    const isHeading = hMed > 0 && l.h > hMed * 1.25 && l.text.length < 200
    const kind: Block['kind'] = isHeading ? 'h' : 'p'
    let newPara = !cur || cur.kind !== kind
    if (!newPara && prev) {
      const gap = prev.y - l.y
      if (gap > lineGap * 1.45 || gap < -hMed) newPara = true
      else if (kind === 'p' && l.x > minX + hMed * 0.9 && prev.x <= minX + hMed * 0.5) newPara = true
      else if (kind === 'p' && prev.width < maxW * 0.7 && /[.!?:"”’)]$/.test(prev.text)) newPara = true
    }
    if (newPara) {
      flush()
      cur = { text: '', spans: [], kind, h: l.h }
    }
    const c = cur!
    let offset = c.text.length
    let spans = l.spans
    if (c.text) {
      const hyphen = /[\p{L}]-$/u.test(c.text) && /^\p{Ll}/u.test(l.text)
      if (hyphen) {
        // drop the hyphen: shorten the last span by one char
        c.text = c.text.slice(0, -1)
        const last = c.spans[c.spans.length - 1]
        if (last) last[3] = Math.max(0, last[3] - 1)
        offset = c.text.length
      } else {
        c.text += ' '
        offset++
      }
    }
    spans = spans.map(([i, lo, io, len]) => [i, lo + offset, io, len] as PdfSpan)
    c.text += l.text
    c.spans.push(...spans)
    prev = l
  }
  flush()
  return blocks
}
