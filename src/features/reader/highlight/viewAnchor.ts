import type { BookIndex } from '@/engine/book/bookIndex'
import { caretFromPoint, type TextPoint, type TextSurface } from './surface'

/**
 * "Where the reader's eyes are": the text point on the reading line and its distance from the top of the scroll
 * container. Used to keep the place when the layout changes (PDF Original <-> Text, font size, margins) and to
 * remember the position when reading without audio.
 */
export interface ViewAnchor extends TextPoint {
  /** pixels from the container's top edge to what was anchored */
  dy: number
  /** what dy was measured on: the text itself, the whole block (e.g. a picture), or a PDF page */
  kind: 'text' | 'block' | 'page'
  page?: number
}

/** The reading line: the same height auto-scroll puts the current sentence at, so saving and restoring don't drift. */
export const READING_LINE = 0.25

function pointRect(surface: TextSurface, p: TextPoint): { rect: DOMRect; precise: boolean } | null {
  for (const r of surface.rangesFor(p.block, p.offset, p.offset + 1)) {
    const rect = r.getBoundingClientRect()
    if (rect.width || rect.height) return { rect, precise: true }
  }
  const el = surface.anchorFor(p.block)
  return el ? { rect: el.getBoundingClientRect(), precise: false } : null
}

/** The text point on the reading line, or null if nothing readable is there yet. */
export function readAnchor(container: HTMLElement, surface: TextSurface, index: BookIndex): ViewAnchor | null {
  const box = container.getBoundingClientRect()
  if (!box.height) return null
  const line = box.top + box.height * READING_LINE + 4
  // the line may fall in the gap between paragraphs: look a little lower too
  for (let step = 0; step < 6; step++) {
    const y = line + step * 12
    for (const fx of [0.5, 0.3, 0.7, 0.15]) {
      const x = box.left + box.width * fx
      const c = caretFromPoint(x, y)
      const found = c && container.contains(c.node) ? surface.locate(c.node, c.offset) : null
      const block = found ? index.blocks[found.block] : undefined
      if (!found || !block || block.skippedAll) continue
      // a caret after the last character belongs to that text, not to whatever comes next
      const p = { block: found.block, offset: Math.max(0, Math.min(found.offset, block.text.length - 1)) }
      const pr = pointRect(surface, p)
      if (!pr) continue
      // in a gap between paragraphs the browser snaps to the nearest text: only accept text on this line
      if (pr.precise && (pr.rect.bottom < y - 2 || pr.rect.top > y + 2)) continue
      return { ...p, dy: pr.rect.top - box.top, kind: pr.precise ? 'text' : 'block' }
    }
  }
  const y = line
  // between paragraphs, or a PDF page that isn't rendered yet: use the element under the line
  const el = document.elementFromPoint(box.left + box.width / 2, y)
  const blockEl = el?.closest<HTMLElement>('[data-b]')
  if (blockEl && container.contains(blockEl)) {
    const block = Number(blockEl.dataset.b)
    return { block, offset: 0, dy: blockEl.getBoundingClientRect().top - box.top, kind: 'block' }
  }
  const pageEl = el?.closest<HTMLElement>('[data-page]')
  if (pageEl && container.contains(pageEl)) {
    const page = Number(pageEl.dataset.page)
    const block = index.blocks.find((b) => b.page === page && !b.skippedAll)
    if (block) return { block: block.index, offset: 0, dy: pageEl.getBoundingClientRect().top - box.top, kind: 'page', page }
  }
  return null
}

/** Scroll so the anchored text is back at its distance from the top. Returns true if placed on the text itself. */
export function restoreAnchor(container: HTMLElement, surface: TextSurface, a: ViewAnchor): boolean {
  const box = container.getBoundingClientRect()
  const place = (top: number, dy: number) => (container.scrollTop += top - box.top - dy)
  // the same kind of thing it was measured on, so the offset means the same
  if (a.kind === 'page' && a.page !== undefined) {
    const pageEl = container.querySelector<HTMLElement>(`[data-page="${a.page}"]`)
    if (pageEl) {
      place(pageEl.getBoundingClientRect().top, a.dy)
      return true
    }
  }
  if (a.kind === 'block') {
    const el = container.querySelector<HTMLElement>(`[data-b="${a.block}"]`)
    if (el) {
      place(el.getBoundingClientRect().top, a.dy)
      return true
    }
  }
  const pr = pointRect(surface, a)
  if (!pr) return false
  // dy only means something for the same kind of thing; otherwise (a page edge or picture that doesn't exist in
  // this view, or text still rendering) put the start of that text on the reading line
  place(pr.rect.top, pr.precise && a.kind === 'text' ? a.dy : box.height * READING_LINE)
  return pr.precise
}
