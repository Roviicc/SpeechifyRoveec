import type { BookIndex } from '@/engine/book/bookIndex'
import type { TextSurface } from './surface'

/**
 * Keeps the current sentence in the upper third of the scroll container. Any manual scroll
 * (wheel, touch, keys, scrollbar) pauses it until resume() — the "Jump to current" pill.
 */
export class AutoScroller {
  paused = false
  enabled = true
  private cleanup: (() => void) | null = null
  constructor(private onPausedChange: (paused: boolean) => void) {}

  attach(container: HTMLElement | null) {
    this.cleanup?.()
    this.cleanup = null
    if (!container) return
    const pause = () => {
      if (!this.paused) {
        this.paused = true
        this.onPausedChange(true)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(e.key)) pause()
    }
    const onPointer = (e: PointerEvent) => {
      // dragging the scrollbar
      if (e.target === container && e.offsetX > container.clientWidth) pause()
    }
    container.addEventListener('wheel', pause, { passive: true })
    container.addEventListener('touchmove', pause, { passive: true })
    container.addEventListener('keydown', onKey)
    container.addEventListener('pointerdown', onPointer)
    this.cleanup = () => {
      container.removeEventListener('wheel', pause)
      container.removeEventListener('touchmove', pause)
      container.removeEventListener('keydown', onKey)
      container.removeEventListener('pointerdown', onPointer)
    }
  }

  resume() {
    if (this.paused) {
      this.paused = false
      this.onPausedChange(false)
    }
  }

  /** Scroll so sentence `i` sits ~25% from the top. `force` ignores pause / comfort zone. */
  scrollTo(container: HTMLElement | null, surface: TextSurface | null, index: BookIndex | null, i: number, opts: { force?: boolean; smooth?: boolean } = {}) {
    if (!container || !surface || !index) return
    if (!opts.force && (this.paused || !this.enabled)) return
    const s = index.sentences[i]
    if (!s) return
    const box = container.getBoundingClientRect()
    let top: number | null = null
    let bottom: number | null = null
    for (const r of surface.rangesFor(s.block, s.start, s.end)) {
      const rect = r.getBoundingClientRect()
      if (rect.height === 0 && rect.width === 0) continue
      top = top === null ? rect.top : Math.min(top, rect.top)
      bottom = bottom === null ? rect.bottom : Math.max(bottom, rect.bottom)
    }
    if (top === null) {
      const el = surface.anchorFor(s.block)
      if (!el) return
      const rect = el.getBoundingClientRect()
      top = rect.top
      bottom = rect.bottom
    }
    const rel = top - box.top
    const comfortable = rel > box.height * 0.08 && (bottom ?? top) - box.top < box.height * 0.6
    if (comfortable && !opts.force) return
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
    container.scrollTo({
      top: container.scrollTop + rel - box.height * 0.25,
      behavior: opts.smooth === false || reduce ? 'auto' : 'smooth',
    })
  }
}
