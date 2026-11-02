import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { getPdfjs } from '@/engine/book/pdf/pdfjs'

/** CSS width of a thumbnail (the canvas is drawn at this width x devicePixelRatio). */
const THUMB_W = 110
/** Thumbnails drawn at the same time. */
const CONCURRENCY = 2
/** Drawn canvases kept in memory; the oldest off-screen ones are cleared beyond this. */
const KEEP = 60

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY
    if (o === 'auto' || o === 'scroll') return n
  }
  return null
}

/**
 * Grid of PDF page thumbnails. Pages are drawn lazily with pdf.js only when their cell scrolls near view;
 * off-screen cells are cheap placeholders sized by the page aspect ratio.
 */
export function PageGrid({ file, current, onPick }: { file: Blob; current: number; onPick: (page: number) => void }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [aspect, setAspect] = useState(1.414)
  const [error, setError] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  // open the PDF; destroy the loading task (and its worker document) on unmount
  useEffect(() => {
    let cancelled = false
    let task: { destroy(): Promise<void> } | null = null
    ;(async () => {
      try {
        const pdfjs = await getPdfjs()
        const data = new Uint8Array(await file.arrayBuffer())
        if (cancelled) return
        const t = pdfjs.getDocument({ data })
        task = t
        const doc = await t.promise
        const vp = (await doc.getPage(1)).getViewport({ scale: 1 })
        if (cancelled) return
        setAspect(vp.height / vp.width)
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

  // lazy drawing: one IntersectionObserver for all cells, a small render queue, an LRU of drawn canvases
  useEffect(() => {
    const grid = gridRef.current
    if (!pdf || !grid) return
    let alive = true
    const near = new Set<number>()
    const queue: number[] = []
    const tasks = new Map<number, RenderTask>()
    const drawn: number[] = []
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const cell = (p: number) => grid.querySelector<HTMLElement>(`[data-page="${p}"]`)

    const evict = () => {
      for (let i = 0; drawn.length > KEEP && i < drawn.length; ) {
        const p = drawn[i]
        if (near.has(p)) {
          i++
          continue
        }
        drawn.splice(i, 1)
        const c = cell(p)?.querySelector('canvas')
        if (c) {
          c.width = 0
          c.height = 0
          c.removeAttribute('data-drawn')
        }
      }
    }

    const draw = async (p: number) => {
      const canvas = cell(p)?.querySelector('canvas')
      if (!canvas) return
      try {
        const page = await pdf.getPage(p + 1)
        if (!alive || !near.has(p)) return
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: (THUMB_W * dpr) / base.width })
        canvas.width = Math.round(viewport.width)
        canvas.height = Math.round(viewport.height)
        const box = canvas.parentElement
        if (box) box.style.aspectRatio = `${base.width} / ${base.height}`
        const task = page.render({ canvas, viewport })
        tasks.set(p, task)
        await task.promise
        if (!alive) return
        canvas.setAttribute('data-drawn', 'true')
        drawn.push(p)
        evict()
      } catch {
        // cancelled (scrolled away / closed) or a broken page: leave the placeholder
      } finally {
        tasks.delete(p)
        if (alive) pump()
      }
    }

    const pump = () => {
      while (alive && tasks.size < CONCURRENCY && queue.length) {
        const p = queue.shift()!
        if (!near.has(p) || tasks.has(p) || cell(p)?.querySelector('canvas[data-drawn]')) continue
        // reserve the slot before the async getPage
        tasks.set(p, { cancel() {}, promise: Promise.resolve() } as unknown as RenderTask)
        void draw(p)
      }
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const p = Number((e.target as HTMLElement).dataset.page)
          if (e.isIntersecting) {
            if (!near.has(p)) {
              near.add(p)
              queue.push(p)
            }
          } else {
            near.delete(p)
            tasks.get(p)?.cancel()
            const qi = queue.indexOf(p)
            if (qi >= 0) queue.splice(qi, 1)
          }
        }
        // draw the top-most pages first
        queue.sort((a, b) => a - b)
        pump()
      },
      { root: scrollParent(grid), rootMargin: '300px 0px' },
    )
    grid.querySelectorAll('[data-page]').forEach((n) => io.observe(n))
    return () => {
      alive = false
      io.disconnect()
      for (const t of tasks.values()) t.cancel()
      tasks.clear()
    }
  }, [pdf])

  // bring the current page into view once the grid exists
  useEffect(() => {
    if (!pdf) return
    requestAnimationFrame(() => gridRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'center' }))
  }, [pdf])

  if (error) return <p className="py-8 text-center text-sm text-muted">Could not show the pages: {error}</p>
  if (!pdf) return <p className="py-8 text-center text-sm text-muted" role="status">Loading pages…</p>

  return (
    <div ref={gridRef} className="grid grid-cols-3 gap-x-3 gap-y-4 pt-1 sm:grid-cols-4" data-testid="page-grid">
      {Array.from({ length: pdf.numPages }, (_, p) => {
        const isCurrent = p === current
        return (
          <button
            key={p}
            type="button"
            data-page={p}
            aria-label={`Page ${p + 1}`}
            aria-current={isCurrent ? 'page' : undefined}
            onClick={() => onPick(p)}
            className="group flex flex-col items-center gap-1.5 rounded-xl p-1 text-xs focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span
              className={`block w-full overflow-hidden rounded-md bg-surface ring-offset-2 ring-offset-bg ${
                isCurrent ? 'ring-[2.5px] ring-primary' : 'ring-1 ring-surface-2 group-hover:ring-muted'
              }`}
              style={{ aspectRatio: `1 / ${aspect}` }}
            >
              <canvas className="block h-full w-full bg-white opacity-0 transition-opacity duration-200 data-[drawn]:opacity-100 motion-reduce:transition-none" aria-hidden />
            </span>
            <span className={isCurrent ? 'font-semibold text-primary' : 'text-muted'}>{p + 1}</span>
          </button>
        )
      })}
    </div>
  )
}
