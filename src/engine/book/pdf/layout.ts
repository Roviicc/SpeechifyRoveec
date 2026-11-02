import type { Block, BlockSkip, PdfSpan } from '@/engine/book/types'
import { isPageNumberLine, normalizeRepeatLine } from '@/engine/text/smartSkip'
import { orderColumns } from './columns'
import { isCaptionText, markFootnotes, markTables } from './junk'

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
  /** horizontal extent [x0, x1] of the text item behind each span (parallel to `spans`) */
  boxes?: Array<[number, number]>
  role?: BlockSkip
  /** set for lines inside a detected text column: the column's left edge and width */
  colX?: number
  colW?: number
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
        const boxes = cur.boxes!
        const keep = cur.spans.map(([i, lo, io, len]) => [i, lo, io, Math.min(len, trimmed.length - lo)] as PdfSpan)
        cur.spans = keep.filter((s) => s[3] > 0)
        cur.boxes = boxes.filter((_, k) => keep[k][3] > 0)
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
        cur = { text: '', x, y, h, width: 0, spans: [], boxes: [] }
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
        cur.boxes!.push([x, x + Math.max(0, it.width)])
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
  // zones are decided by position on the page, not by content-stream order
  const zones = pages.map((lines) => {
    const byY = [...lines].sort((a, b) => b.y - a.y)
    return { top: new Set(byY.slice(0, zone)), bottom: new Set(byY.slice(-zone)) }
  })
  pages.forEach((_, p) => {
    const seen = new Set<string>()
    zones[p].top.forEach((l) => seen.add(keyOf(l, true)))
    zones[p].bottom.forEach((l) => seen.add(keyOf(l, false)))
    for (const k of seen) counts.set(k, (counts.get(k) ?? 0) + 1)
  })
  const minRepeats = Math.max(3, Math.ceil(pages.length * 0.25))
  pages.forEach((lines, p) => {
    for (const l of lines) {
      const top = zones[p].top.has(l)
      const bottom = zones[p].bottom.has(l)
      if (!top && !bottom) continue
      if (isPageNumberLine(l.text)) {
        l.role = 'pagenum'
        continue
      }
      if (pages.length < 3) continue
      if (top && (counts.get(keyOf(l, true)) ?? 0) >= minRepeats) l.role = 'header'
      else if (bottom && (counts.get(keyOf(l, false)) ?? 0) >= minRepeats) l.role = 'footer'
    }
  })
}

function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * q))]
}

/** Role lines that stay one block per line (footnote lines are joined into paragraphs instead). */
const LINE_ROLES = new Set<BlockSkip>(['header', 'footer', 'pagenum', 'table'])

/**
 * Full page pipeline after `groupLines`: running headers/footers and page numbers, column order,
 * footnotes and tables, then paragraphs. Mutates `pages` (roles, column order).
 */
export function pagesToBlocks(pages: PdfLine[][]): Block[][] {
  markRepeatedLines(pages)
  for (let p = 0; p < pages.length; p++) pages[p] = orderColumns(pages[p])
  const allBody = pages.flat().filter((l) => !l.role).map((l) => l.h).sort((a, b) => a - b)
  const bodyHeight = allBody[allBody.length >> 1]
  return pages.map((lines, i) => {
    markFootnotes(lines, bodyHeight)
    markTables(lines)
    return linesToBlocks(lines, i, bodyHeight)
  })
}

/** Assemble lines into paragraphs/headings, de-hyphenating wrapped words. */
export function linesToBlocks(lines: PdfLine[], page: number, bodyHeight?: number): Block[] {
  const body = lines.filter((l) => !l.role)
  const hMed = bodyHeight ?? quantile(body.map((l) => l.h), 0.5)
  const gaps: number[] = []
  for (let i = 1; i < body.length; i++) {
    const g = body[i - 1].y - body[i].y
    if (g > 0) gaps.push(g)
  }
  // typical line spacing: a low quantile so paragraph gaps don't inflate it
  const lineGap = quantile(gaps, 0.3) || hMed * 1.2
  const pageMinX = Math.min(...body.map((l) => l.x))
  const pageMaxW = Math.max(...body.map((l) => l.width))
  // inside a detected column, indentation and line width are measured against the column
  const minXOf = (l: PdfLine) => l.colX ?? pageMinX
  const maxWOf = (l: PdfLine) => l.colW ?? pageMaxW

  const blocks: Block[] = []
  let cur: { text: string; spans: PdfSpan[]; kind: Block['kind']; h: number; skip?: BlockSkip } | null = null
  const flush = () => {
    if (cur && /\S/.test(cur.text)) {
      const b: Block = { text: cur.text, kind: cur.kind, page, spans: cur.spans }
      if (cur.skip) b.skip = cur.skip
      else if (isCaptionText(cur.text)) b.skip = 'caption'
      blocks.push(b)
    }
    cur = null
  }
  let prev: PdfLine | null = null
  for (const l of lines) {
    if (l.role && LINE_ROLES.has(l.role)) {
      flush()
      blocks.push({ text: l.text, kind: 'p', page, spans: l.spans, skip: l.role })
      continue
    }
    // footnote lines are joined into paragraphs like body text, but never mixed with it
    const isHeading = !l.role && hMed > 0 && l.h > hMed * 1.25 && l.text.length < 200
    const kind: Block['kind'] = isHeading ? 'h' : 'p'
    let newPara = !cur || cur.kind !== kind || cur.skip !== l.role
    if (!newPara && prev) {
      const gap = prev.y - l.y
      if (gap < -hMed) {
        // jumped up. In a column layout a sentence may run on from the bottom of one column to the top of the next.
        const runsOn =
          kind === 'p' &&
          l.colX !== undefined &&
          l.x > prev.x &&
          prev.width >= maxWOf(prev) * 0.7 &&
          !/[.!?:"”’)]$/.test(prev.text) &&
          /^\p{Ll}/u.test(l.text)
        if (!runsOn) newPara = true
      } else if (gap > lineGap * 1.45) newPara = true
      else if (kind === 'p' && l.x > minXOf(l) + hMed * 0.9 && prev.x <= minXOf(prev) + hMed * 0.5) newPara = true
      else if (kind === 'p' && prev.width < maxWOf(prev) * 0.7 && /[.!?:"”’)]$/.test(prev.text)) newPara = true
    }
    if (newPara) {
      flush()
      cur = { text: '', spans: [], kind, h: l.h, skip: l.role }
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
