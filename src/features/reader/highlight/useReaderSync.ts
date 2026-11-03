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
import { anchorMisplaced, READING_LINE, readAnchor, restoreAnchor, type ViewAnchor } from './viewAnchor'
import { pinWhileSettling } from './pin'

/** Is sentence i away from the reading line (or not laid out yet)? */
function sentenceMisplaced(container: HTMLElement, surface: TextSurface, index: BookIndex, i: number): boolean {
  const sent = index.sentences[i]
  if (!sent) return false
  const box = container.getBoundingClientRect()
  const r = surface.rangesFor(sent.block, sent.start, sent.end).map((x) => x.getBoundingClientRect()).find((x) => x.height > 0)
  if (!r) return true
  const off = r.top - box.top - box.height * READING_LINE
  // at the very top or bottom the page can't scroll further: as close as possible is right
  if (off < 0 && container.scrollTop <= 0) return false
  if (off > 0 && container.scrollTop >= container.scrollHeight - container.clientHeight - 1) return false
  return Math.abs(off) > 3
}

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
  /** Block on the reading line, as React state for "where am I" displays (changes only when the block changes). */
  const [viewBlock, setViewBlock] = useState<number | null>(null)
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
        if (a) {
          anchor.current = a
          setViewBlock(a.block)
        }
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

  // text settings changed: the text reflows, put the same words back on the same line (and keep them there while
  // the new layout settles — the restyle can land a frame after this effect)
  const firstLayout = useRef(true)
  const stopReflowPin = useRef<() => void>(() => {})
  useLayoutEffect(() => {
    if (firstLayout.current) {
      firstLayout.current = false
      return
    }
    const a = anchor.current
    if (!container || !surface || !a) return
    stopReflowPin.current()
    const at = Date.now()
    frozen.current = true
    stopReflowPin.current = pinWhileSettling(
      container,
      () => void restoreAnchor(container, surface, a),
      () => anchorMisplaced(container, surface, a),
      () => lastUserScroll.current > at,
      unfreeze,
    )
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
      if (a && !following) {
        if (a.kind !== 'text') return false
        const box = container.getBoundingClientRect()
        const r = surface.rangesFor(a.block, a.offset, a.offset + 1)[0]?.getBoundingClientRect()
        return !r || Math.abs(r.top - box.top - a.dy) > 3
      }
      return sentenceMisplaced(container, surface, index, i)
    }
    let stop = () => {}
    const raf = requestAnimationFrame(() => {
      // the reader already scrolled while the view was being prepared: leave the page where they put it
      if (!container || lastUserScroll.current > placedAt || (!a && container.scrollTop > 0)) {
        unfreeze()
        return
      }
      stop = pinWhileSettling(
        container,
        place,
        misplaced,
        // the reader took over, or a jump moved the voice elsewhere (that target wins)
        () => lastUserScroll.current > placedAt || session().player.index !== i || !!pendingRestore.current,
        () => {
          if (!pendingRestore.current) unfreeze()
        },
      )
    })
    return () => {
      cancelAnimationFrame(raf)
      stop()
    }
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
    let stopJump = () => {}
    const offSentence = player.on('sentence', (i) => {
      highlighter.setSentence(i)
      // Only the voice reading on to the next sentence respects "the reader scrolled away".
      // Any jump (Contents, Search, Notes, bookmarks, chapter buttons, Play from here) always shows its target.
      const readingOn = player.isActive && i === prev + 1
      prev = i
      if (!readingOn) {
        scroller.current!.resume()
        stopJump()
        if (!container) return
        const at = Date.now()
        // land at once, then stay on target while the chapter lays out (a smooth scroll aims at a moving target)
        stopJump = pinWhileSettling(
          container,
          () => scroller.current!.scrollTo(container, surface, index, i, { force: true, smooth: false }),
          () => sentenceMisplaced(container, surface, index, i),
          () => lastUserScroll.current > at || player.index !== i,
        )
      } else {
        scroller.current!.scrollTo(container, surface, index, i)
      }
    })
    const offState = player.on('state', (st) => {
      if (st === 'playing') start()
    })
    if (player.state === 'playing') start()
    return () => {
      stopJump()
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

  /**
   * What a tap at this point would jump to (null: nothing — and a tap that ends a selection clears it here).
   * Read at the moment of the tap, so a caller may delay the jump itself (double-tap window in PDF Original).
   */
  const tapPoint = useCallback(
    (e: { target: EventTarget | null; clientX: number; clientY: number }): TextPoint | null => {
      if (!surface || !index) return null
      // a tap ends a long-press selection instead of jumping
      if (Date.now() < readerSelection.suppressTapUntil) return null
      if (readerSelection.active) {
        readerSelection.clear()
        return null
      }
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed) return null
      if ((e.target as HTMLElement | null)?.closest('button, a, input')) return null
      const c = caretFromPoint(e.clientX, e.clientY)
      if (!c) return null
      const p = surface.locate(c.node, c.offset)
      if (!p || index.blocks[p.block]?.skippedAll) return null
      return p
    },
    [surface, index],
  )

  const onTap = useCallback(
    (e: React.MouseEvent) => {
      const p = tapPoint(e)
      if (p) playFrom(p, true)
    },
    [tapPoint, playFrom],
  )

  return { highlighter, viewBlock, jumpVisible, jumpToCurrent, onTap, tapPoint, onSurfaceUpdated, playFrom, scroller: scroller.current! }
}
