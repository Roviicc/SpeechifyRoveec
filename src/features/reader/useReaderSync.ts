import { useCallback, useEffect, useRef, useState } from 'react'
import type { BookIndex } from '../../engine/doc/bookIndex'
import { sentenceAt } from '../../engine/doc/bookIndex'
import { wordIndexAt, wordIndexAtOffset, wordTimings, type WordTiming } from '../../engine/text/timing'
import { session } from '../../app/session'
import { useSettings } from '../../store/settings'
import { Highlighter } from './highlighter'
import { AutoScroller } from './autoScroll'
import { caretFromPoint, type TextPoint, type TextSurface } from './surface'

/**
 * Connects the playback session to a rendered surface: sentence/word highlight (rAF loop),
 * auto-scroll with "Jump to current", and tap-to-jump.
 */
export function useReaderSync(container: HTMLElement | null, surface: TextSurface | null, index: BookIndex | null) {
  const highlighter = useRef(new Highlighter()).current
  const [jumpVisible, setJumpVisible] = useState(false)
  const scroller = useRef<AutoScroller | null>(null)
  scroller.current ??= new AutoScroller(setJumpVisible)
  const showSentence = useSettings((s) => s.highlightSentence)
  const showWord = useSettings((s) => s.highlightWord)
  const autoScroll = useSettings((s) => s.autoScroll)

  useEffect(() => {
    scroller.current!.attach(container)
    return () => scroller.current!.attach(null)
  }, [container])

  useEffect(() => {
    scroller.current!.enabled = autoScroll
  }, [autoScroll])

  useEffect(() => {
    highlighter.showSentence = showSentence
    highlighter.showWord = showWord
    highlighter.refresh()
  }, [highlighter, showSentence, showWord])

  // attach + initial position
  useEffect(() => {
    highlighter.attach(surface, index)
    if (!surface || !index) return
    const i = session().player.index
    highlighter.setSentence(i)
    requestAnimationFrame(() => scroller.current!.scrollTo(container, surface, index, i, { force: true, smooth: false }))
  }, [highlighter, surface, index, container])

  useEffect(() => () => highlighter.clear(), [highlighter])

  // sentence changes + word loop
  useEffect(() => {
    if (!surface || !index) return
    const player = session().player
    let timings: { i: number; d: number; t: WordTiming[] } | null = null
    let raf = 0
    const tick = () => {
      raf = 0
      const i = player.index
      const d = player.duration
      const s = index.sentences[i]
      if (s && d) {
        if (!timings || timings.i !== i || timings.d !== d) timings = { i, d, t: wordTimings(s.spoken, d) }
        const w = wordIndexAt(timings.t, player.currentTime)
        highlighter.setWord(w >= 0 ? timings.t[w] : null)
      }
      if (player.state === 'playing') raf = requestAnimationFrame(tick)
    }
    const start = () => {
      if (!raf) raf = requestAnimationFrame(tick)
    }
    const offSentence = player.on('sentence', (i) => {
      highlighter.setSentence(i)
      scroller.current!.scrollTo(container, surface, index, i)
    })
    const offState = player.on('state', (st) => {
      if (st === 'playing') start()
    })
    if (player.state === 'playing') start()
    return () => {
      offSentence()
      offState()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [surface, index, container, highlighter])

  const jumpToCurrent = useCallback(() => {
    scroller.current!.resume()
    scroller.current!.scrollTo(container, surface, index, session().player.index, { force: true })
  }, [container, surface, index])

  /** Called after part of the surface re-rendered (e.g. a PDF page). */
  const onSurfaceUpdated = useCallback(() => {
    highlighter.refresh()
    if (!scroller.current!.paused) scroller.current!.scrollTo(container, surface, index, session().player.index, { smooth: false })
  }, [highlighter, container, surface, index])

  /** Start reading at a text point (word-accurate within the sentence). */
  const playFrom = useCallback(
    (p: TextPoint, autoplay = true) => {
      if (!index) return
      const i = sentenceAt(index, p.block, p.offset)
      const s = index.sentences[i]
      let fraction = 0
      if (s && s.block === p.block && p.offset > s.start && s.spoken.words.length) {
        const wi = wordIndexAtOffset(s.spoken.words, p.offset)
        let before = s.spoken.leadWeight
        for (let k = 0; k < wi; k++) before += s.spoken.words[k].weight
        fraction = before / s.spoken.totalWeight
      }
      scroller.current!.resume()
      session().seekTo(i, autoplay, { fraction })
    },
    [index],
  )

  const onTap = useCallback(
    (e: React.MouseEvent) => {
      if (!surface || !index) return
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed) return
      if ((e.target as HTMLElement).closest('button, a, input')) return
      const c = caretFromPoint(e.clientX, e.clientY)
      if (!c) return
      const p = surface.locate(c.node, c.offset)
      if (!p || index.blocks[p.block]?.skippedAll) return
      playFrom(p, true)
    },
    [surface, index, playFrom],
  )

  return { highlighter, jumpVisible, jumpToCurrent, onTap, onSurfaceUpdated, playFrom, scroller: scroller.current! }
}
