import type { FlatBlock } from '../../engine/doc/bookIndex'

export interface TextPoint {
  block: number
  offset: number
}

/** Something that displays the book's blocks and can map text offsets <-> DOM ranges. */
export interface TextSurface {
  rangesFor(block: number, start: number, end: number): Range[]
  locate(node: Node, offset: number): TextPoint | null
  /** element to scroll to when no range is available yet (e.g. page not rendered) */
  anchorFor(block: number): HTMLElement | null
  /** whether inline "skipped" text should be dimmed (not for transparent PDF text layers) */
  dimSkipped: boolean
}

/** Resolve an (element, childIndex) boundary to a (textNode, offset) boundary. */
export function toTextBoundary(node: Node, offset: number): { node: Node; offset: number } {
  if (node.nodeType === Node.TEXT_NODE) return { node, offset }
  const kids = node.childNodes
  if (offset < kids.length) {
    let n: Node | null = kids[offset]
    while (n && n.nodeType !== Node.TEXT_NODE) n = n.firstChild ?? n.nextSibling
    if (n) return { node: n, offset: 0 }
  }
  let n: Node | null = node.lastChild
  while (n && n.nodeType !== Node.TEXT_NODE) n = n.lastChild ?? n.previousSibling
  return n ? { node: n, offset: (n as Text).length } : { node, offset }
}

export function caretFromPoint(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y)
    return p ? { node: p.offsetNode, offset: p.offset } : null
  }
  const r = d.caretRangeFromPoint?.(x, y)
  return r ? { node: r.startContainer, offset: r.startOffset } : null
}

/** All text nodes under `el`, in document order (their concatenation is `el.textContent`). */
export function textNodes(el: Node): Text[] {
  const out: Text[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text)
  return out
}

/**
 * Reflowed text: one element per block whose `textContent` equals the block text. The text may be split
 * over several text nodes (inline formatting spans, table cells), so offsets are mapped with a running sum.
 */
export class ReflowSurface implements TextSurface {
  dimSkipped = true
  private els = new Map<number, HTMLElement>()
  constructor(root: HTMLElement) {
    root.querySelectorAll<HTMLElement>('[data-b]').forEach((el) => this.els.set(Number(el.dataset.b), el))
  }

  rangesFor(block: number, start: number, end: number): Range[] {
    const el = this.els.get(block)
    if (!el) return []
    const nodes = textNodes(el)
    if (!nodes.length) return []
    if (end < start) end = start
    // start prefers the beginning of the next node at a boundary, end prefers the end of the previous one
    let pos = 0
    let s: { node: Text; offset: number } | null = null
    let e: { node: Text; offset: number } | null = null
    for (const n of nodes) {
      const len = n.length
      if (!s && start < pos + len) s = { node: n, offset: start - pos }
      if (s && !e && end <= pos + len) e = { node: n, offset: Math.max(end - pos, s.node === n ? s.offset : 0) }
      if (s && e) break
      pos += len
    }
    const last = nodes[nodes.length - 1]
    s ??= { node: last, offset: last.length }
    e ??= { node: last, offset: last.length }
    const r = document.createRange()
    r.setStart(s.node, s.offset)
    r.setEnd(e.node, e.offset)
    return [r]
  }

  locate(node: Node, offset: number): TextPoint | null {
    const b = toTextBoundary(node, offset)
    const el = (b.node.nodeType === Node.TEXT_NODE ? b.node.parentElement : (b.node as Element))?.closest<HTMLElement>('[data-b]')
    if (!el) return null
    const nodes = textNodes(el)
    if (!nodes.length) return null // images: nothing to read or select
    let pos = 0
    for (const n of nodes) {
      if (n === b.node) return { block: Number(el.dataset.b), offset: pos + Math.min(b.offset, n.length) }
      pos += n.length
    }
    return { block: Number(el.dataset.b), offset: 0 }
  }

  anchorFor(block: number) {
    return this.els.get(block) ?? null
  }
}

/** Original PDF pages: blocks map to pdf.js text-layer spans through PdfSpan tables. */
export class PdfSurface implements TextSurface {
  dimSkipped = false
  /** page -> text-layer divs (index = text item index) */
  pages = new Map<number, HTMLElement[]>()
  pageEls = new Map<number, HTMLElement>()
  private byPage = new Map<number, FlatBlock[]>()
  constructor(private blocks: FlatBlock[]) {
    for (const b of blocks) {
      if (b.page === undefined) continue
      const list = this.byPage.get(b.page) ?? []
      list.push(b)
      this.byPage.set(b.page, list)
    }
  }

  rangesFor(block: number, start: number, end: number): Range[] {
    const b = this.blocks[block]
    if (!b || b.page === undefined || !b.spans) return []
    const divs = this.pages.get(b.page)
    if (!divs) return []
    const out: Range[] = []
    for (const [item, bo, io, len] of b.spans) {
      const s = Math.max(start, bo)
      const e = Math.min(end, bo + len)
      if (e <= s) continue
      const node = divs[item]?.firstChild
      if (!node || node.nodeType !== Node.TEXT_NODE) continue
      const tl = (node as Text).length
      const r = document.createRange()
      r.setStart(node, Math.min(tl, io + (s - bo)))
      r.setEnd(node, Math.min(tl, io + (e - bo)))
      out.push(r)
    }
    return out
  }

  locate(node: Node, offset: number): TextPoint | null {
    const t = toTextBoundary(node, offset)
    const span = (t.node.nodeType === Node.TEXT_NODE ? t.node.parentElement : (t.node as Element))?.closest<HTMLElement>('[data-i]')
    const pageEl = span?.closest<HTMLElement>('[data-page]')
    if (!span || !pageEl) return null
    const item = Number(span.dataset.i)
    const page = Number(pageEl.dataset.page)
    const off = t.node.parentElement === span ? t.offset : 0
    let best: TextPoint | null = null
    for (const b of this.byPage.get(page) ?? []) {
      for (const [i, bo, io, len] of b.spans ?? []) {
        if (i !== item) continue
        if (off >= io && off <= io + len) return { block: b.index, offset: bo + (off - io) }
        best ??= { block: b.index, offset: bo }
      }
    }
    return best
  }

  anchorFor(block: number) {
    const b = this.blocks[block]
    if (!b || b.page === undefined) return null
    const divs = this.pages.get(b.page)
    const first = b.spans?.[0]
    if (divs && first) return divs[first[0]] ?? this.pageEls.get(b.page) ?? null
    return this.pageEls.get(b.page) ?? null
  }
}
