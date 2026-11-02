import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BookIndex } from '@/engine/book/bookIndex'
import { sentenceAt } from '@/engine/book/bookIndex'
import { wordIndexAt, wordIndexAtOffset, wordTimings, type WordTiming } from '@/engine/text/timing'
import { session } from '@/session/session'
import { useSettings } from '@/state/settings'
import { Highlighter } from './highlighter'
import { AutoScroller } from './autoScroll'
import { readerSelection } from './useReaderSelection'
import { caretFromPoint, type TextPoint, type TextSurface } from './surface'
import { READING_LINE, readAnchor, restoreAnchor, type ViewAnchor } from './viewAnchor'

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
  const fontSize = useSettings((s) => s.fontSize)
  const fontFamily = useSettings((s) => s.fontFamily)
  const lineHeight = useSettings((s) => s.lineHeight)
  const margin = useSettings((s) => s.margin)

  /** What is on the reading line right now; survives layout changes (mode switch, text settings). */
  const anchor = useRef<ViewAnchor | null>(null)
  /** While the layout is being swapped, scroll events describe a half-built page: don't track them. */
  const frozen = useRef(false)
  /** A restore that still waits for content (e.g. the PDF page isn't rendered yet). */
  const pendingRestore = useRef<ViewAnchor | null>(null)
  /** Last time the reader scrolled by hand: automatic corrections never fight the reader. */
  const lastUserScroll = useRef(0)
  /** Re-read the reading line now (used when tracking resumes after a layout change). */
  const track = useRef<() => void>(() => {})
  const unfreeze = () => {
    frozen.current = false
    track.current() // anything scrolled while frozen is picked up now
  }

  // follow the reading line while scrolling; after the reader scrolled by hand without audio, save the place
  useEffect(() => {
    if (!container || !surface || !index) return
    let raf = 0
    let userMoved = false
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    const markUser = () => {
      userMoved = true
      lastUserScroll.current = Date.now()
    }
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        if (frozen.current) return
        const a = readAnchor(container, surface, index)
        if (a) anchor.current = a
        if (!userMoved || !a) return
        clearTimeout(saveTimer)
        saveTimer = setTimeout(() => {
          const s = session()
          if (s.player.isActive || !anchor.current) return
          const p = anchor.current
          s.saveViewPosition({ section: index.blocks[p.block]?.section ?? 0, block: p.block, offset: p.offset })
        }, 1200)
      })
    }
    track.current = onScroll
    container.addEventListener('scroll', onScroll, { passive: true })
    container.addEventListener('wheel', markUser, { passive: true })
    container.addEventListener('touchmove', markUser, { passive: true })
    container.addEventListener('keydown', markUser)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(saveTimer)
      container.removeEventListener('scroll', onScroll)
      container.removeEventListener('wheel', markUser)
      container.removeEventListener('touchmove', markUser)
      container.removeEventListener('keydown', markUser)
    }
  }, [container, surface, index])

  // text settings changed: the text reflows, put the same words back on the same line
  const firstLayout = useRef(true)
  useLayoutEffect(() => {
    if (firstLayout.current) {
      firstLayout.current = false
      return
    }
    if (container && surface && anchor.current) restoreAnchor(container, surface, anchor.current)
  }, [fontSize, fontFamily, lineHeight, margin, container, surface])

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
    if (!surface || !index) {
      frozen.current = true // the view is being rebuilt (e.g. PDF Original <-> Text)
      return
    }
    const i = session().player.index
    highlighter.setSentence(i)
    const following = session().player.isActive && !scroller.current!.paused
    const a = anchor.current
    const place = () => {
      if (container && a && !following) {
        // same view, new layout: keep the reader's place
        if (!restoreAnchor(container, surface, a)) pendingRestore.current = a
      } else {
        scroller.current!.scrollTo(container, surface, index, i, { force: true, smooth: false })
      }
    }
    const placedAt = Date.now()
    // Is the target where it should be? (the sentence on the reading line, or the anchor at its old height)
    const misplaced = (): boolean => {
      if (!container) return false
      const box = container.getBoundingClientRect()
      if (a && !following) {
        if (a.kind !== 'text') return false
        const r = surface.rangesFor(a.block, a.offset, a.offset + 1)[0]?.getBoundingClientRect()
        return !r || Math.abs(r.top - box.top - a.dy) > 3
      }
      const sent = index.sentences[i]
      if (!sent) return false
      const r = surface.rangesFor(sent.block, sent.start, sent.end).map((x) => x.getBoundingClientRect()).find((x) => x.height > 0)
      return !r || Math.abs(r.top - box.top - box.height * READING_LINE) > 3
    }
    let raf = 0
    requestAnimationFrame(() => {
      // the reader already scrolled while the view was being prepared: leave the page where they put it
      if (lastUserScroll.current > placedAt) {
        unfreeze()
        return
      }
      place()
      let placedTop = container?.scrollTop ?? 0
      // Long chapters keep settling for a moment after opening (content-visibility lays out off-screen sections
      // lazily). Check every frame for a short while and nudge the place back, until it holds still — and never
      // once the reader has moved the page.
      let good = 0
      let frames = 0
      let unfrozen = false
      const settle = () => {
        raf = 0
        // anything else moved the page (the reader, Contents/Search/Notes, a link): stop correcting at once.
        // Layout settling moves the content, not scrollTop, so a changed scrollTop always means someone scrolled.
        const movedByOthers = container ? Math.abs(container.scrollTop - placedTop) > 1 : false
        if (movedByOthers || lastUserScroll.current > placedAt || pendingRestore.current) {
          // the reader took over (or a PDF page is still rendering): stop correcting, keep tracking
          if (!unfrozen && !pendingRestore.current) unfreeze()
          return
        }
        if (misplaced()) {
          good = 0
          place()
          placedTop = container?.scrollTop ?? 0
        } else good++
        if (!unfrozen && good >= 1) {
          unfrozen = true
          unfreeze()
        }
        if (good < 4 && ++frames < 90) raf = requestAnimationFrame(settle)
        else if (!unfrozen) unfreeze()
      }
      raf = requestAnimationFrame(settle)
    })
    return () => cancelAnimationFrame(raf)
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
    let prev = player.index
    const offSentence = player.on('sentence', (i) => {
      highlighter.setSentence(i)
      // Only the voice reading on to the next sentence respects "the reader scrolled away".
      // Any jump (Contents, Search, Notes, bookmarks, chapter buttons, Play from here) always shows its target.
      const readingOn = player.isActive && i === prev + 1
      prev = i
      if (!readingOn) {
        scroller.current!.resume()
        scroller.current!.scrollTo(container, surface, index, i, { force: true })
      } else {
        scroller.current!.scrollTo(container, surface, index, i)
      }
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
    const a = pendingRestore.current
    if (a && container && surface) {
      // the page the reader was on just rendered: land on the exact line
      if (restoreAnchor(container, surface, a)) {
        pendingRestore.current = null
        requestAnimationFrame(unfreeze)
      }
      return
    }
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

  /** Start the voice at the sentence on the reading line ("Play from here"). */
  const playFromView = useCallback(() => {
    // what is on the reading line at the moment of the tap
    const a = (container && surface && index ? readAnchor(container, surface, index) : null) ?? anchor.current
    if (!a || !index) return
    scroller.current!.resume()
    session().seekTo(sentenceAt(index, a.block, a.offset), true)
  }, [container, surface, index])

  const onTap = useCallback(
    (e: React.MouseEvent) => {
      if (!surface || !index) return
      // a tap ends a long-press selection instead of jumping
      if (Date.now() < readerSelection.suppressTapUntil) return
      if (readerSelection.active) return readerSelection.clear()
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

  return { highlighter, jumpVisible, jumpToCurrent, playFromView, onTap, onSurfaceUpdated, playFrom, scroller: scroller.current! }
}
