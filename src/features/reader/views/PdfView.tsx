import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { getPdfjs } from '@/engine/book/pdf/pdfjs'
import type { BookIndex } from '@/engine/book/bookIndex'
import { PdfSurface } from '@/features/reader/highlight/surface'
import { useSettings } from '@/state/settings'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100))
/** Zoom level a double tap goes to when the tapped paragraph can't be measured. */
const DOUBLE_TAP_ZOOM = 2

/** What the reader screen can ask of the page view. */
export interface PdfApi {
  /** Double tap at a screen point: zoom in on it, or back to fit-width if zoomed in. */
  doubleTap(x: number, y: number): void
}

interface Rendered {
  scale: number
  cancel: () => void
}

/** Original PDF pages: canvas + pdf.js text layer, rendered lazily near the viewport. */
export function PdfView({
  file,
  index,
  scrollEl,
  onSurface,
  onUpdated,
  apiRef,
}: {
  file: Blob
  index: BookIndex
  scrollEl: HTMLElement | null
  onSurface: (s: PdfSurface) => void
  onUpdated: () => void
  apiRef?: { current: PdfApi | null }
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [sizes, setSizes] = useState<Array<{ w: number; h: number }>>([])
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(0)
  const innerRef = useRef<HTMLDivElement>(null)
  const surface = useMemo(() => new PdfSurface(index.blocks), [index])
  const rendered = useRef(new Map<number, Rendered>())
  const onUpdatedRef = useRef(onUpdated)
  onUpdatedRef.current = onUpdated
  const pendingScroll = useRef<{ left: number; top: number } | null>(null)
  /** zoom commits move the page: page snapping leaves the scroll that follows alone */
  const noSnapUntil = useRef(0)
  const snapPages = useSettings((s) => s.snapPages)
  const darkPages = useSettings((s) => s.darkPages)

  useEffect(() => onSurface(surface), [surface, onSurface])

  useEffect(() => {
    let cancelled = false
    let task: { destroy(): Promise<void> } | null = null
    ;(async () => {
      try {
        const pdfjs = await getPdfjs()
        const t = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
        task = t
        const doc = await t.promise
        const s: Array<{ w: number; h: number }> = []
        for (let i = 1; i <= doc.numPages; i++) {
          const vp = (await doc.getPage(i)).getViewport({ scale: 1 })
          s.push({ w: vp.width, h: vp.height })
        }
        if (cancelled) return
        setSizes(s)
        setPdf(doc)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    })()
    return () => {
      cancelled = true
      void task?.destroy()
    }
  }, [file])

  useEffect(() => {
    if (!scrollEl) return
    const ro = new ResizeObserver(() => setWidth(scrollEl.clientWidth))
    ro.observe(scrollEl)
    setWidth(scrollEl.clientWidth)
    return () => ro.disconnect()
  }, [scrollEl])

  const fit = sizes.length && width ? Math.min(2.5, (width - 16) / sizes[0].w) : 1
  const scale = fit * zoom

  // lazy render / unrender pages around the viewport
  useEffect(() => {
    const inner = innerRef.current
    if (!pdf || !inner || !scrollEl) return
    const map = rendered.current
    const unrender = (i: number, el: HTMLElement) => {
      map.get(i)?.cancel()
      map.delete(i)
      el.querySelector('canvas')?.remove()
      el.querySelector('.textLayer')?.remove()
      surface.pages.delete(i)
    }
    const render = (i: number, el: HTMLElement) => {
      if (map.get(i)?.scale === scale) return
      unrender(i, el)
      let cancelled = false
      let cancelTask: (() => void) | null = null
      map.set(i, { scale, cancel: () => ((cancelled = true), cancelTask?.()) })
      ;(async () => {
        const pdfjs = await getPdfjs()
        const page = await pdf.getPage(i + 1)
        if (cancelled) return
        const viewport = page.getViewport({ scale })
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const maxPixels = 16_000_000
        const k = Math.min(dpr, Math.sqrt(maxPixels / (viewport.width * viewport.height)))
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width * k)
        canvas.height = Math.floor(viewport.height * k)
        canvas.setAttribute('aria-hidden', 'true')
        const task = page.render({ canvas, viewport, transform: k !== 1 ? [k, 0, 0, k, 0, 0] : undefined })
        cancelTask = () => task.cancel()
        el.prepend(canvas)
        const textDiv = document.createElement('div')
        textDiv.className = 'textLayer'
        el.append(textDiv)
        const tl = new pdfjs.TextLayer({ textContentSource: await page.getTextContent(), container: textDiv, viewport })
        await tl.render()
        if (cancelled) return
        tl.textDivs.forEach((d, n) => (d.dataset.i = String(n)))
        surface.pages.set(i, tl.textDivs)
        onUpdatedRef.current()
        await task.promise.catch(() => {})
      })().catch(() => {})
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement
          const i = Number(el.dataset.page)
          if (e.isIntersecting) render(i, el)
          else unrender(i, el)
        }
      },
      { root: scrollEl, rootMargin: '150% 0px' },
    )
    inner.querySelectorAll<HTMLElement>('[data-page]').forEach((el) => {
      surface.pageEls.set(Number(el.dataset.page), el)
      io.observe(el)
    })
    return () => {
      io.disconnect()
      inner.querySelectorAll<HTMLElement>('[data-page]').forEach((el) => unrender(Number(el.dataset.page), el))
    }
  }, [pdf, scale, scrollEl, surface])

  // keep the pinch point steady after a zoom commit
  useLayoutEffect(() => {
    if (pendingScroll.current && scrollEl) {
      scrollEl.scrollLeft = pendingScroll.current.left
      scrollEl.scrollTop = pendingScroll.current.top
      pendingScroll.current = null
    }
  }, [zoom, scrollEl])

  /**
   * Zoom keeping the screen point (cx, cy) where it is. `toLeft`: instead put that content point at this distance
   * from the container's left edge (double tap centres the tapped spot or lines up the paragraph).
   */
  const zoomTo = (z: number, cx?: number, cy?: number, toLeft?: number) => {
    if (!scrollEl) return
    const next = clampZoom(z)
    const box = scrollEl.getBoundingClientRect()
    const x = cx !== undefined ? cx - box.left : scrollEl.clientWidth / 2
    const y = cy !== undefined ? cy - box.top : scrollEl.clientHeight / 2
    const r = next / zoom
    pendingScroll.current = { left: (scrollEl.scrollLeft + x) * r - (toLeft ?? x), top: (scrollEl.scrollTop + y) * r - y }
    noSnapUntil.current = Date.now() + 600
    setZoom(next)
  }
  const zoomRef = useRef(zoomTo)
  zoomRef.current = zoomTo

  /** Left and right screen edges of the paragraph at (x, y) on the tapped page, if its text layer is there. */
  const paragraphAt = (x: number, y: number): { left: number; right: number } | null => {
    const pageEl = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-page]')
    if (!pageEl) return null
    const page = Number(pageEl.dataset.page)
    const divs = surface.pages.get(page)
    if (!divs) return null
    let best: { left: number; right: number; d: number } | null = null
    for (const b of index.blocks) {
      if (b.page !== page || b.skippedAll || !b.spans) continue
      const rs = b.spans.map(([item]) => divs[item]?.getBoundingClientRect()).filter((r): r is DOMRect => !!r && r.width > 0)
      if (!rs.length) continue
      const top = Math.min(...rs.map((r) => r.top))
      const bottom = Math.max(...rs.map((r) => r.bottom))
      const d = y < top ? top - y : y > bottom ? y - bottom : 0
      if (!best || d < best.d) best = { left: Math.min(...rs.map((r) => r.left)), right: Math.max(...rs.map((r) => r.right)), d }
    }
    return best && best.d < 40 ? best : null
  }

  const doubleTap = (x: number, y: number) => {
    if (!scrollEl) return
    // zoomed in: back to fit-width, the tapped spot stays under the finger
    if (zoom > 1.05) return zoomTo(1, x, y)
    const avail = scrollEl.clientWidth - 24
    const para = paragraphAt(x, y)
    const fitPara = para ? Math.min(MAX_ZOOM, (zoom * avail) / (para.right - para.left)) : 0
    if (para && fitPara >= 1.15) {
      // the paragraph (column) fills the width: reading needs no sideways panning
      const w = (para.right - para.left) * (fitPara / zoom)
      return zoomTo(fitPara, para.left, y, 12 + (avail - w) / 2)
    }
    // otherwise 2x, the tapped spot in the middle
    zoomTo(DOUBLE_TAP_ZOOM, x, y, scrollEl.clientWidth / 2)
  }
  const doubleTapRef = useRef(doubleTap)
  doubleTapRef.current = doubleTap
  useEffect(() => {
    if (!apiRef) return
    apiRef.current = { doubleTap: (x, y) => doubleTapRef.current(x, y) }
    return () => {
      apiRef.current = null
    }
  }, [apiRef])

  // "Snap to pages": after the reader scrolls by hand (never after auto-scroll, a jump or a zoom), settle with the
  // nearest page's top at the top of the screen when one is close. JS rather than CSS scroll-snap, which would
  // also snap the programmatic scrolls that keep the voice's sentence on the reading line.
  useEffect(() => {
    if (!scrollEl || !snapPages) return
    let byHand = false
    let touching = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const hand = () => {
      byHand = true
    }
    const down = () => {
      touching = true
      byHand = true
    }
    const up = () => {
      touching = false
    }
    const settle = () => {
      clearTimeout(timer)
      if (!byHand || touching) return
      byHand = false
      if (Date.now() < noSnapUntil.current) return
      const box = scrollEl.getBoundingClientRect()
      let best: number | null = null
      for (const el of scrollEl.querySelectorAll<HTMLElement>('[data-page]')) {
        const d = el.getBoundingClientRect().top - box.top
        if (best === null || Math.abs(d) < Math.abs(best)) best = d
      }
      if (best === null || Math.abs(best) < 2 || Math.abs(best) > scrollEl.clientHeight * 0.3) return
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
      scrollEl.scrollTo({ top: scrollEl.scrollTop + best, behavior: reduce ? 'auto' : 'smooth' })
    }
    // `scrollend` where the browser has it; otherwise a pause in scroll events
    const hasScrollEnd = 'onscrollend' in window
    const onScroll = () => {
      clearTimeout(timer)
      timer = setTimeout(settle, 180)
    }
    scrollEl.addEventListener('wheel', hand, { passive: true })
    scrollEl.addEventListener('keydown', hand)
    scrollEl.addEventListener('touchstart', down, { passive: true })
    scrollEl.addEventListener('touchend', up, { passive: true })
    scrollEl.addEventListener('touchcancel', up, { passive: true })
    if (hasScrollEnd) scrollEl.addEventListener('scrollend', settle)
    else scrollEl.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      clearTimeout(timer)
      scrollEl.removeEventListener('wheel', hand)
      scrollEl.removeEventListener('keydown', hand)
      scrollEl.removeEventListener('touchstart', down)
      scrollEl.removeEventListener('touchend', up)
      scrollEl.removeEventListener('touchcancel', up)
      scrollEl.removeEventListener('scrollend', settle)
      scrollEl.removeEventListener('scroll', onScroll)
    }
  }, [scrollEl, snapPages])

  // pinch-zoom (touch) and ctrl+wheel (trackpad) — CSS transform during the gesture, re-render at the end
  useEffect(() => {
    const inner = innerRef.current
    if (!scrollEl || !inner) return
    const pts = new Map<number, { x: number; y: number }>()
    let start: { d: number; cx: number; cy: number } | null = null
    let ratio = 1
    const dist = () => {
      const [a, b] = [...pts.values()]
      return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
    }
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pts.size === 2) {
        start = dist()
        ratio = 1
        const box = inner.getBoundingClientRect()
        inner.style.transformOrigin = `${start.cx - box.left}px ${start.cy - box.top}px`
      }
    }
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (start && pts.size === 2) {
        ratio = Math.min(MAX_ZOOM / zoomCur.current, Math.max(MIN_ZOOM / zoomCur.current, dist().d / start.d))
        inner.style.transform = `scale(${ratio})`
      }
    }
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId)
      if (start && pts.size < 2) {
        inner.style.transform = ''
        if (Math.abs(ratio - 1) > 0.02) zoomRef.current(zoomCur.current * ratio, start.cx, start.cy)
        start = null
      }
    }
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      zoomRef.current(zoomCur.current * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY)
    }
    scrollEl.addEventListener('pointerdown', down)
    scrollEl.addEventListener('pointermove', move)
    scrollEl.addEventListener('pointerup', up)
    scrollEl.addEventListener('pointercancel', up)
    scrollEl.addEventListener('wheel', wheel, { passive: false })
    return () => {
      scrollEl.removeEventListener('pointerdown', down)
      scrollEl.removeEventListener('pointermove', move)
      scrollEl.removeEventListener('pointerup', up)
      scrollEl.removeEventListener('pointercancel', up)
      scrollEl.removeEventListener('wheel', wheel)
    }
  }, [scrollEl])
  const zoomCur = useRef(zoom)
  zoomCur.current = zoom

  if (error) return <p className="p-8 text-center text-red-600">Couldn’t open this PDF: {error}</p>
  return (
    <>
      <div ref={innerRef} className={`py-3 pb-48 ${darkPages ? 'dark-pages' : ''}`} data-snap={snapPages || undefined}style={{ touchAction: 'pan-x pan-y', width: Math.max(width, sizes[0] ? sizes[0].w * scale + 16 : 0) }} data-testid="pdf-pages">
        {!pdf && <p className="p-8 text-center text-muted">Loading pages…</p>}
        {sizes.map((s, i) => (
          <div
            key={i}
            data-page={i}
            className="pdf-page"
            style={{ width: Math.floor(s.w * scale), height: Math.floor(s.h * scale), ['--total-scale-factor' as string]: scale }}
            aria-label={`Page ${i + 1}`}
          />
        ))}
      </div>
      <div className="pointer-events-none sticky bottom-3 z-10 flex justify-end pr-20 pl-3" style={{ left: 0 }}>
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-line bg-bg/95 p-1 shadow-[var(--shadow)] backdrop-blur">
          <button aria-label="Zoom out" className="grid h-10 w-10 place-items-center rounded-full hover:bg-surface disabled:opacity-40" disabled={zoom <= MIN_ZOOM} onClick={() => zoomTo(zoom - 0.25)} data-testid="zoom-out">
            <Minus size={18} />
          </button>
          <button className="min-w-14 text-sm font-semibold tabular-nums" onClick={() => zoomTo(1)} aria-label="Fit to width" data-testid="zoom-level">
            {Math.round(zoom * 100)}%
          </button>
          <button aria-label="Zoom in" className="grid h-10 w-10 place-items-center rounded-full hover:bg-surface disabled:opacity-40" disabled={zoom >= MAX_ZOOM} onClick={() => zoomTo(zoom + 0.25)} data-testid="zoom-in">
            <Plus size={18} />
          </button>
        </div>
      </div>
    </>
  )
}
