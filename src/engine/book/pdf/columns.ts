import type { PdfSpan } from '@/engine/book/types'
import type { PdfLine } from './layout'

/**
 * Multi-column page layout. A page is treated as columns only when there is a clear vertical
 * gutter: a strip in the middle part of the page that (almost) no line crosses, with enough
 * long lines on both sides of it, and the lines right of it starting at a common left edge.
 * Lines on such pages are reordered column by column; anything that spans the gutter (title,
 * full-width headings, figures, footnotes) splits the page into horizontal bands that are read in
 * order: content above the columns, the columns (left top→bottom, then right), content below.
 * Pages without a gutter are returned unchanged (content-stream order).
 */

type Box = [number, number]

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[s.length >> 1]
}

function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * q))]
}

function boxesOf(l: PdfLine): Box[] {
  return l.boxes && l.boxes.length === l.spans.length && l.boxes.length ? l.boxes : [[l.x, l.x + l.width]]
}

/** True when a line can be split into fragments by its item boxes. */
function splittable(l: PdfLine): boolean {
  return !!l.boxes && l.boxes.length === l.spans.length && l.boxes.length > 0
}

/** A new line made of some of `src`'s spans (indices in increasing order); spans stay exact. */
export function fragmentLine(src: PdfLine, ks: number[]): PdfLine | null {
  let text = ''
  const spans: PdfSpan[] = []
  const boxes: Box[] = []
  let prevK = -1
  for (const k of ks) {
    const [i, lo, io0, len0] = src.spans[k]
    let io = io0
    let len = len0
    let piece = src.text.slice(lo, lo + len)
    if (text.length) {
      // adjacent spans keep the original text between them (a space or nothing)
      const between = prevK === k - 1 ? src.text.slice(src.spans[prevK][1] + src.spans[prevK][3], lo) : ' '
      if (!(between === ' ' && text.endsWith(' '))) text += between
    }
    if (!text.length || text.endsWith(' ')) {
      const lead = piece.length - piece.trimStart().length
      piece = piece.slice(lead)
      io += lead
      len -= lead
    }
    prevK = k
    if (!len) continue
    spans.push([i, text.length, io, len])
    boxes.push(src.boxes![k])
    text += piece
  }
  const trimmed = text.trimEnd()
  if (!/\S/.test(trimmed)) return null
  const keep = spans.map(([i, lo, io, len]) => [i, lo, io, Math.min(len, trimmed.length - lo)] as PdfSpan)
  const outSpans = keep.filter((s) => s[3] > 0)
  const outBoxes = boxes.filter((_, k) => keep[k][3] > 0)
  const x = Math.min(...outBoxes.map((b) => b[0]))
  const x1 = Math.max(...outBoxes.map((b) => b[1]))
  const out: PdfLine = { text: trimmed, x, y: src.y, h: src.h, width: x1 - x, spans: outSpans, boxes: outBoxes }
  if (src.role) out.role = src.role
  return out
}

interface Gutter {
  g0: number
  g1: number
  x0: number
  x1: number
  hMed: number
}

/** A line's relation to a gutter: crossing it, or split into the parts left and right of it. */
function sides(l: PdfLine, g: Gutter): { cross: boolean; left: number[]; right: number[] } {
  const bs = boxesOf(l)
  const cross = bs.some(([a, b]) => a < g.g1 - 0.5 && b > g.g0 + 0.5)
  const left: number[] = []
  const right: number[] = []
  if (!cross) bs.forEach(([a, b], k) => ((a + b) / 2 < (g.g0 + g.g1) / 2 ? left : right).push(k))
  return { cross, left, right }
}

function extent(bs: Box[], ks: number[]): Box {
  return [Math.min(...ks.map((k) => bs[k][0])), Math.max(...ks.map((k) => bs[k][1]))]
}

/** Find the most convincing column gutter among the page's lines, or null. */
export function findGutter(lines: PdfLine[], minSide = 6): Gutter | null {
  const body = lines.filter((l) => !l.role)
  if (body.length < 2 * minSide) return null
  const hMed = median(body.map((l) => l.h))
  if (!(hMed > 0)) return null
  let x0 = Infinity
  let x1 = -Infinity
  for (const l of body)
    for (const [a, b] of boxesOf(l)) {
      x0 = Math.min(x0, a)
      x1 = Math.max(x1, b)
    }
  const W = x1 - x0
  if (!(W >= hMed * 15) || W > 20000) return null

  // per-unit coverage: how many lines have text over each x position
  const n = Math.ceil(W) + 1
  const cov = new Int32Array(n)
  const stamp = new Int32Array(n).fill(-1)
  body.forEach((l, li) => {
    for (const [a, b] of boxesOf(l)) {
      const from = Math.max(0, Math.floor(a - x0))
      const to = Math.min(n - 1, Math.ceil(b - x0) - 1)
      for (let u = from; u <= to; u++)
        if (stamp[u] !== li) {
          stamp[u] = li
          cov[u]++
        }
    }
  })

  // candidate strips: runs of low coverage away from the outer edges
  const lo = Math.ceil(W * 0.2)
  const hi = Math.floor(W * 0.8)
  const limit = Math.floor(body.length * 0.3)
  const tol = Math.max(1, Math.floor(body.length * 0.05))
  const candidates: Gutter[] = []
  for (let u = lo; u <= hi; u++) {
    if (cov[u] > limit) continue
    let end = u
    while (end + 1 <= hi && cov[end + 1] <= limit) end++
    // core of the run: the widest stretch close to its minimum coverage
    let min = Infinity
    for (let v = u; v <= end; v++) min = Math.min(min, cov[v])
    let best: [number, number] | null = null
    for (let v = u; v <= end; v++) {
      if (cov[v] > min + tol) continue
      let e = v
      while (e + 1 <= end && cov[e + 1] <= min + tol) e++
      if (!best || e - v > best[1] - best[0]) best = [v, e]
      v = e
    }
    if (best && best[1] + 1 - best[0] >= hMed * 0.6) candidates.push({ g0: x0 + best[0], g1: x0 + best[1] + 1, x0, x1, hMed })
    u = end
  }

  let chosen: Gutter | null = null
  let chosenScore = 0
  for (const g of candidates) {
    const leftW = g.g0 - g.x0
    const rightW = g.x1 - g.g1
    if (leftW < hMed * 6 || rightW < hMed * 6) continue
    const lw: number[] = []
    const rw: number[] = []
    const rStarts: number[] = []
    let cross = 0
    for (const l of body) {
      const s = sides(l, g)
      if (s.cross) {
        cross++
        continue
      }
      const bs = boxesOf(l)
      if (s.left.length) {
        const [a, b] = extent(bs, s.left)
        lw.push(b - a)
      }
      if (s.right.length) {
        const [a, b] = extent(bs, s.right)
        rw.push(b - a)
        rStarts.push(a)
      }
    }
    if (lw.length < minSide || rw.length < minSide) continue
    // real columns are filled with long lines (tables with a wide gap between short cells are not).
    // Measured against the longest lines of each side, so a side may itself hold several columns.
    const long = (ws: number[]) => median(ws) >= Math.max(hMed * 6, quantile(ws, 0.9) * 0.6)
    if (!long(lw) || !long(rw)) continue
    // the right column has a common left edge
    const edge = quantile(rStarts, 0.1)
    if (rStarts.filter((a) => a <= edge + hMed * 2).length < rStarts.length * 0.5) continue
    if (cross > (lw.length + rw.length) * 0.75) continue
    const score = lw.length + rw.length - cross
    if (!chosen || score > chosenScore) {
      chosen = g
      chosenScore = score
    }
  }
  return chosen
}

const byPosition = (a: PdfLine, b: PdfLine) => b.y - a.y || a.x - b.x

function order(lines: PdfLine[], depth: number): PdfLine[] {
  if (depth > 4) return lines
  const g = findGutter(lines, depth ? 4 : 6)
  if (!g) {
    if (!depth) return lines
    // a leaf column: top to bottom, and remember the column geometry for paragraph detection
    const body = lines.filter((l) => !l.role)
    const colX = Math.min(...body.map((l) => l.x))
    const colW = Math.max(...body.map((l) => l.x + l.width)) - colX
    for (const l of body) {
      l.colX = colX
      l.colW = colW
    }
    return [...lines].sort(byPosition)
  }
  const leftW = g.g0 - g.x0
  const rightW = g.x1 - g.g1
  const mid = (g.g0 + g.g1) / 2
  type Entry = { line: PdfLine; side: 'full' | 'L' | 'R' }
  const entries: Entry[] = []
  const crossing: PdfLine[] = []
  for (const l of lines) {
    if (l.role) {
      entries.push({ line: l, side: 'full' })
      continue
    }
    const s = sides(l, g)
    if (s.cross) {
      crossing.push(l)
      continue
    }
    if (s.left.length && s.right.length && splittable(l)) {
      const a = fragmentLine(l, s.left)
      const b = fragmentLine(l, s.right)
      if (a) entries.push({ line: a, side: 'L' })
      if (b) entries.push({ line: b, side: 'R' })
    } else entries.push({ line: l, side: s.right.length && !s.left.length ? 'R' : 'L' })
  }
  const colYs = entries.filter((e) => e.side !== 'full').map((e) => e.line.y)
  const top = Math.max(...colYs)
  const bottom = Math.min(...colYs)
  for (const l of crossing) {
    const [a, b] = extent(boxesOf(l), boxesOf(l).map((_, k) => k))
    const wide = a <= g.g0 - leftW * 0.25 && b >= g.g1 + rightW * 0.25
    // above or below the columns, and really reaching into both of them (a title, a full-width figure)
    const outside = (l.y > top + g.hMed * 0.3 || l.y < bottom - g.hMed * 0.3) && a <= g.g0 - g.hMed * 2 && b >= g.g1 + g.hMed * 2
    const centred = Math.abs((a + b) / 2 - mid) <= g.hMed * 2
    // a line that only bleeds into the gutter belongs to the column it mostly sits in
    entries.push({ line: l, side: wide || outside || centred ? 'full' : (a + b) / 2 < mid ? 'L' : 'R' })
  }
  entries.sort((p, q) => byPosition(p.line, q.line))
  const out: PdfLine[] = []
  let left: PdfLine[] = []
  let right: PdfLine[] = []
  const flush = () => {
    if (left.length) out.push(...order(left, depth + 1))
    if (right.length) out.push(...order(right, depth + 1))
    left = []
    right = []
  }
  for (const e of entries) {
    if (e.side === 'full') {
      flush()
      out.push(e.line)
    } else (e.side === 'L' ? left : right).push(e.line)
  }
  flush()
  return out
}

/** Reorder a page's lines column by column when the page has a column layout; otherwise return them unchanged. */
export function orderColumns(lines: PdfLine[]): PdfLine[] {
  return order(lines, 0)
}
