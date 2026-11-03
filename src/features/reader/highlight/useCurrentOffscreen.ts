import { useEffect, useState } from 'react'
import type { BookIndex } from '@/engine/book/bookIndex'
import { session } from '@/session/session'
import type { Highlighter } from './highlighter'
import type { TextSurface } from './surface'

export interface Offscreen {
  /** where the voice's place is, relative to what's on screen */
  side: 'above' | 'below'
  /** the word being spoken (or the sentence's first word before the voice reaches one) */
  word: string
}

const firstWord = (text: string) => text.trim().split(/\s+/)[0] ?? ''
const clean = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') || w

/** Is the voice's current sentence scrolled out of view? Polls lightly (word changes) and on scroll. */
export function useCurrentOffscreen(
  container: HTMLElement | null,
  surface: TextSurface | null,
  index: BookIndex | null,
  highlighter: Highlighter,
  active: boolean,
): Offscreen | null {
  const [state, setState] = useState<Offscreen | null>(null)

  useEffect(() => {
    if (!active || !container || !surface || !index) {
      setState(null)
      return
    }
    let raf = 0
    const measure = () => {
      raf = 0
      const i = session().player.index
      const s = index.sentences[i]
      if (!s) return setState(null)
      let top: number | null = null
      let bottom: number | null = null
      for (const r of surface.rangesFor(s.block, s.start, s.end)) {
        const rect = r.getBoundingClientRect()
        if (!rect.width && !rect.height) continue
        top = top === null ? rect.top : Math.min(top, rect.top)
        bottom = bottom === null ? rect.bottom : Math.max(bottom, rect.bottom)
      }
      if (top === null || bottom === null) {
        const el = surface.anchorFor(s.block)
        if (!el) return setState(null)
        const rect = el.getBoundingClientRect()
        top = rect.top
        bottom = rect.bottom
      }
      const box = container.getBoundingClientRect()
      const side = bottom < box.top + 8 ? 'above' : top > box.bottom - 8 ? 'below' : null
      if (!side) return setState(null)
      const text = index.blocks[s.block]?.text ?? ''
      const w = highlighter.sentence === i ? highlighter.word : null
      const word = clean(w ? text.slice(w.start, w.end) : firstWord(text.slice(s.start, s.end)))
      setState((prev) => (prev?.side === side && prev.word === word ? prev : { side, word }))
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure)
    }
    schedule()
    const timer = setInterval(schedule, 200)
    container.addEventListener('scroll', schedule, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(timer)
      container.removeEventListener('scroll', schedule)
    }
  }, [active, container, surface, index, highlighter])

  return state
}
