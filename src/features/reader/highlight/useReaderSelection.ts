import { useCallback, useEffect, useRef, useState } from 'react'
import type { BookIndex } from '@/engine/book/bookIndex'
import { splitWords } from '@/engine/text/segment'
import { caretFromPoint, type TextPoint, type TextSurface } from './surface'

export interface SelectionInfo {
  start: TextPoint
  end: TextPoint
  text: string
  rect: DOMRect
}

/** Touch screens use Lumen's own long-press selection (no Android text menu, no Chrome "Touch to Search"). */
export const isTouchSelection = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

/** Shared with tap-to-jump: a tap right after a long-press, or while a selection is shown, must not jump. */
export const readerSelection = {
  active: false,
  suppressTapUntil: 0,
  clear: () => {},
}

const LONG_PRESS_MS = 450
const MOVE_TOLERANCE = 10

type HighlightRegistry = Map<string, unknown>
function paint(ranges: Range[]) {
  const reg = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS?.highlights
  const H = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight
  if (!reg || !H) return
  if (ranges.length) reg.set('reader-sel', new H(...ranges))
  else reg.delete('reader-sel')
}

interface Word {
  block: number
  start: number
  end: number
}

/** The word (block-relative offsets) at a text point, or the nearest one in that block. */
function wordAt(index: BookIndex, p: TextPoint): Word | null {
  const text = index.blocks[p.block]?.text
  if (!text) return null
  const words = splitWords(text)
  if (!words.length) return null
  const w = words.find((x) => p.offset >= x.start && p.offset <= x.end) ?? words.reduce((a, b) => (Math.abs(b.start - p.offset) < Math.abs(a.start - p.offset) ? b : a))
  return { block: p.block, start: w.start, end: w.end }
}

const before = (a: Word, b: Word) => a.block < b.block || (a.block === b.block && a.start <= b.start)

function describe(index: BookIndex, surface: TextSurface, a: Word, b: Word): SelectionInfo | null {
  const [s, e] = before(a, b) ? [a, b] : [b, a]
  const ranges: Range[] = []
  const parts: string[] = []
  for (let blk = s.block; blk <= e.block; blk++) {
    const text = index.blocks[blk]?.text ?? ''
    const from = blk === s.block ? s.start : 0
    const to = blk === e.block ? e.end : text.length
    if (to > from) {
      ranges.push(...surface.rangesFor(blk, from, to))
      parts.push(text.slice(from, to))
    }
  }
  paint(ranges)
  const rects = ranges.map((r) => r.getBoundingClientRect()).filter((r) => r.width || r.height)
  if (!rects.length) return null
  const top = Math.min(...rects.map((r) => r.top))
  const left = Math.min(...rects.map((r) => r.left))
  const right = Math.max(...rects.map((r) => r.right))
  const bottom = Math.max(...rects.map((r) => r.bottom))
  return {
    start: { block: s.block, offset: s.start },
    end: { block: e.block, offset: e.end },
    text: parts.join(' ').replace(/\s+/g, ' ').trim(),
    rect: new DOMRect(left, top, right - left, bottom - top),
  }
}

/**
 * Current text selection in the reader.
 * - Mouse/trackpad: the browser's own selection (selectionchange).
 * - Touch: long-press selects a word, keep holding and drag to extend word by word, release to show the toolbar.
 *   Native selection is turned off on the container, so Android's menu and Chrome's Touch to Search never appear.
 */
export function useReaderSelection(container: HTMLElement | null, surface: TextSurface | null, index: BookIndex | null) {
  const [sel, setSel] = useState<SelectionInfo | null>(null)
  const touch = useRef(isTouchSelection())

  const clear = useCallback(() => {
    paint([])
    window.getSelection()?.removeAllRanges()
    readerSelection.active = false
    setSel(null)
  }, [])

  useEffect(() => {
    readerSelection.clear = clear
    return () => {
      readerSelection.clear = () => {}
      paint([])
    }
  }, [clear])

  // mouse: native selection
  useEffect(() => {
    if (touch.current) return
    let t: ReturnType<typeof setTimeout>
    const update = () => {
      clearTimeout(t)
      t = setTimeout(() => {
        const s = window.getSelection()
        if (!s || s.isCollapsed || !s.rangeCount || !container || !surface) return setSel(null)
        const r = s.getRangeAt(0)
        if (!container.contains(r.commonAncestorContainer)) return setSel(null)
        const a = surface.locate(r.startContainer, r.startOffset)
        const b = surface.locate(r.endContainer, r.endOffset)
        const text = r.toString().replace(/\s+/g, ' ').trim()
        if (!a || !b || !text) return setSel(null)
        const [start, end] = a.block < b.block || (a.block === b.block && a.offset <= b.offset) ? [a, b] : [b, a]
        setSel({ start, end, text, rect: r.getBoundingClientRect() })
      }, 120)
    }
    document.addEventListener('selectionchange', update)
    return () => {
      clearTimeout(t)
      document.removeEventListener('selectionchange', update)
    }
  }, [container, surface])

  // touch: own long-press selection
  useEffect(() => {
    if (!touch.current || !container || !surface || !index) return
    container.classList.add('touch-select')
    let timer: ReturnType<typeof setTimeout> | undefined
    let startX = 0
    let startY = 0
    let anchor: Word | null = null
    let dragging = false

    const pointWord = (x: number, y: number) => {
      const c = caretFromPoint(x, y)
      const p = c && surface.locate(c.node, c.offset)
      return p && !index.blocks[p.block]?.skippedAll ? wordAt(index, p) : null
    }
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      startX = t.clientX
      startY = t.clientY
      clearTimeout(timer)
      timer = setTimeout(() => {
        const w = pointWord(startX, startY)
        if (!w) return
        anchor = w
        dragging = true
        readerSelection.active = true
        navigator.vibrate?.(10)
        setSel(null) // hide the toolbar while dragging
        describe(index, surface, w, w)
      }, LONG_PRESS_MS)
    }
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0]
      if (!dragging) {
        if (Math.hypot(t.clientX - startX, t.clientY - startY) > MOVE_TOLERANCE) clearTimeout(timer)
        return
      }
      e.preventDefault() // extend the selection instead of scrolling
      const w = pointWord(t.clientX, t.clientY)
      if (w && anchor) describe(index, surface, anchor, w)
    }
    const onEnd = (e: TouchEvent) => {
      clearTimeout(timer)
      if (!dragging || !anchor) return
      dragging = false
      readerSelection.suppressTapUntil = Date.now() + 600
      const t = e.changedTouches[0]
      const w = (t && pointWord(t.clientX, t.clientY)) ?? anchor
      setSel(describe(index, surface, anchor, w))
    }
    const noMenu = (e: Event) => e.preventDefault()
    const onScroll = () => {
      if (readerSelection.active && !dragging) clear()
    }
    container.addEventListener('touchstart', onStart, { passive: true })
    container.addEventListener('touchmove', onMove, { passive: false })
    container.addEventListener('touchend', onEnd)
    container.addEventListener('touchcancel', onEnd)
    container.addEventListener('contextmenu', noMenu)
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      clearTimeout(timer)
      container.classList.remove('touch-select')
      container.removeEventListener('touchstart', onStart)
      container.removeEventListener('touchmove', onMove)
      container.removeEventListener('touchend', onEnd)
      container.removeEventListener('touchcancel', onEnd)
      container.removeEventListener('contextmenu', noMenu)
      container.removeEventListener('scroll', onScroll)
    }
  }, [container, surface, index, clear])

  return { sel, clear }
}
