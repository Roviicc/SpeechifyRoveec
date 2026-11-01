import { Player, type SeekOffset } from '../engine/tts/player'
import { createBackend } from '../engine/tts/select'
import type { TtsBackend } from '../engine/tts/types'
import { buildBookIndex, sectionEndSentence, sentenceAt, type BookIndex } from '../engine/doc/bookIndex'
import type { BookDoc } from '../engine/doc/types'
import { audioStore } from '../data/audioCache'
import { saveProgress } from '../data/repo'
import type { Locator } from '../data/db'
import { settingsSnapshot, useSettings } from '../store/settings'
import { usePlayback } from '../store/playback'
import { setupMediaSession, updateMediaPosition } from './mediaSession'

export interface OpenBook {
  id: string
  title: string
  cover?: string
  doc: BookDoc
  /** persist progress for this book (false for the scratch TTS test page) */
  persist: boolean
}

type IndexListener = (index: BookIndex) => void

/** The single playback session: one Player, the open book and its sentence index. */
class Session {
  readonly backend: TtsBackend
  readonly player: Player
  book: OpenBook | null = null
  index: BookIndex | null = null
  private indexListeners = new Set<IndexListener>()
  private lastSaved = 0
  private sleepTimeout: ReturnType<typeof setTimeout> | null = null
  private skipKey = ''

  constructor() {
    this.backend = createBackend()
    this.player = new Player({ backend: this.backend, store: audioStore, prefetch: 3 })
    this.player.setSpeed(useSettings.getState().speed)
    usePlayback.setState({ speed: this.player.speed })

    this.player.on('state', (state) => {
      usePlayback.setState({ state, error: state === 'error' ? usePlayback.getState().error : undefined })
      if (state === 'paused' || state === 'ended') void this.saveNow()
      updateMediaPosition(this)
    })
    this.player.on('sentence', (i) => {
      const section = this.index?.sentences[i]?.section ?? 0
      const { section: prevSection, index: prevIndex } = usePlayback.getState()
      usePlayback.setState({ index: i, section })
      const sleep = usePlayback.getState().sleep
      // only when reading on into the next chapter, not when the user jumps somewhere else
      if (sleep.mode === 'chapter' && section !== prevSection && i === prevIndex + 1 && this.player.isActive) {
        // reached the next chapter: stop at its start
        this.clearSleep()
        void this.player.fadeOutAndPause(3000)
      }
      if (Date.now() - this.lastSaved > 4000) void this.saveNow()
      updateMediaPosition(this)
    })
    this.player.on('error', (e) => usePlayback.setState({ error: e.message }))
    this.player.on('chunk', ({ index, duration }) => {
      const s = this.index?.sentences[index]
      if (s && duration > 0 && s.chars > 20) this.secondsPerChar = this.secondsPerChar * 0.9 + (duration / s.chars) * 0.1
    })
    this.player.on('rtf', (rtf) => usePlayback.setState({ rtf }))
    setupMediaSession(this)

    // rebuild the sentence index when smart-skip or pronunciation settings change
    this.skipKey = this.indexKey()
    useSettings.subscribe((st) => {
      // speed can also change from sync (settings replaced from another device)
      if (st.speed !== this.player.speed) {
        this.player.setSpeed(st.speed)
        usePlayback.setState({ speed: this.player.speed })
      }
      const key = this.indexKey()
      if (key !== this.skipKey) {
        this.skipKey = key
        this.reindex()
      }
    })
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void this.saveNow()
      })
    }
  }

  private indexKey() {
    const s = useSettings.getState()
    return JSON.stringify([s.skip, s.dictionary])
  }

  onIndex(fn: IndexListener): () => void {
    this.indexListeners.add(fn)
    if (this.index) fn(this.index)
    return () => this.indexListeners.delete(fn)
  }

  /** Make sure the voice model is loading; reports download progress to the store. */
  ensureModel(): Promise<void> {
    const m = usePlayback.getState().model
    if (m.status === 'ready' || m.status === 'downloading' || m.status === 'loading') return Promise.resolve()
    usePlayback.setState({ model: { ...m, status: 'loading', error: undefined } })
    return this.backend
      .init((p) =>
        usePlayback.setState({
          model: { status: p.status, fraction: p.fraction, loadedBytes: p.loadedBytes, totalBytes: p.totalBytes },
        }),
      )
      .then((info) => {
        usePlayback.setState({ device: `${info.device} / ${info.dtype}`, model: { ...usePlayback.getState().model, status: 'ready' } })
        void navigator.storage?.persist?.()
      })
      .catch((e: Error) => {
        usePlayback.setState({ model: { ...usePlayback.getState().model, status: 'error', error: e.message } })
      })
  }

  open(book: OpenBook, start?: Locator | number) {
    if (this.book?.id === book.id && this.index) {
      this.book = book
      if (start !== undefined) this.seekTo(start, false)
      return
    }
    if (this.book?.persist) void this.saveNow()
    this.player.pause()
    this.book = book
    const s = settingsSnapshot()
    this.index = buildBookIndex(book.doc, { skip: s.skip, dictionary: s.dictionary })
    const idx = this.index
    const startIndex = typeof start === 'number' ? start : start ? sentenceAt(idx, start.block, start.offset) : 0
    this.player.setSource(
      { bookId: book.id, count: idx.sentences.length, text: (i) => idx.sentences[i].spoken.text },
      startIndex,
    )
    usePlayback.setState({
      bookId: book.id,
      title: book.title,
      cover: book.cover,
      count: idx.sentences.length,
      index: this.player.index,
      section: idx.sentences[this.player.index]?.section ?? 0,
      state: 'idle',
    })
    this.indexListeners.forEach((fn) => fn(idx))
    updateMediaPosition(this)
  }

  close() {
    void this.saveNow()
    this.player.pause()
    this.book = null
    this.index = null
    usePlayback.setState({ bookId: null, title: '', state: 'idle', count: 0, index: 0 })
  }

  private reindex() {
    if (!this.book || !this.index) return
    const loc = this.locator()
    const wasActive = this.player.isActive
    const book = this.book
    this.book = null
    this.index = null
    this.open(book, loc ?? 0)
    if (wasActive) this.play()
  }

  /** Stable locator of the current sentence. */
  locator(i = this.player.index): Locator | null {
    const s = this.index?.sentences[i]
    if (!s) return null
    return { section: s.section, block: s.block, offset: s.start }
  }

  play() {
    void this.ensureModel()
    this.player.play()
  }

  toggle() {
    if (this.player.isActive) this.player.pause()
    else this.play()
  }

  seekTo(target: Locator | number, autoplay?: boolean, offset: SeekOffset = 0) {
    if (!this.index) return
    const i = typeof target === 'number' ? target : sentenceAt(this.index, target.block, target.offset)
    if (autoplay) void this.ensureModel()
    this.player.seek(i, offset, autoplay)
  }

  nextSection(dir: 1 | -1) {
    const idx = this.index
    if (!idx) return
    const cur = idx.sentences[this.player.index]?.section ?? 0
    const starts = idx.sectionSentenceStart
    if (dir === 1) {
      for (let s = cur + 1; s < starts.length; s++) {
        if (starts[s] < idx.sentences.length && idx.sentences[starts[s]].section === s) return this.seekTo(starts[s])
      }
    } else {
      const curStart = starts[cur]
      // like "previous track": go to the start of this section first
      if (this.player.index > curStart + 1) return this.seekTo(curStart)
      for (let s = cur - 1; s >= 0; s--) {
        if (starts[s] < idx.sentences.length && idx.sentences[starts[s]].section === s) return this.seekTo(starts[s])
      }
    }
  }

  setSpeed(speed: number) {
    this.player.setSpeed(speed)
    usePlayback.setState({ speed: this.player.speed })
    useSettings.getState().set({ speed: this.player.speed })
    updateMediaPosition(this)
  }

  /** Seconds of audio per spoken character at 1x (refined from real audio as it is generated). */
  secondsPerChar = 0.068

  estimate(): { elapsed: number; total: number; sectionRemaining: number } {
    const idx = this.index
    if (!idx || !idx.sentences.length) return { elapsed: 0, total: 0, sectionRemaining: 0 }
    const i = this.player.index
    const k = this.secondsPerChar / this.player.speed
    const d = this.player.duration
    const within = d ? Math.min(1, this.player.currentTime / d) : 0
    const elapsedChars = idx.cumChars[i] + idx.sentences[i].chars * within
    const sec = idx.sentences[i].section
    const end = sectionEndSentence(idx, sec)
    return {
      elapsed: elapsedChars * k,
      total: idx.totalChars * k,
      sectionRemaining: Math.max(0, idx.cumChars[end + 1] - elapsedChars) * k,
    }
  }

  /** Map a fraction of the book (0..1) to a sentence index. */
  sentenceAtFraction(f: number): number {
    const idx = this.index
    if (!idx) return 0
    const target = f * idx.totalChars
    let lo = 0
    let hi = idx.sentences.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (idx.cumChars[mid] <= target) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  async saveNow() {
    const book = this.book
    const idx = this.index
    if (!book?.persist || !idx) return
    const loc = this.locator()
    if (!loc) return
    this.lastSaved = Date.now()
    const i = this.player.index
    await saveProgress({
      bookId: book.id,
      sentence: i,
      locator: loc,
      percent: idx.totalChars ? idx.cumChars[i] / idx.totalChars : 0,
      sectionTitle: book.doc.sections[loc.section]?.title ?? '',
    })
  }

  // ---------- sleep timer ----------
  setSleep(mode: 'off' | 'chapter' | number) {
    this.clearSleep()
    if (mode === 'off') return
    if (mode === 'chapter') {
      usePlayback.setState({ sleep: { mode: 'chapter' } })
      return
    }
    const ms = mode * 60_000
    usePlayback.setState({ sleep: { mode: 'minutes', minutes: mode, endsAt: Date.now() + ms } })
    this.sleepTimeout = setTimeout(() => {
      this.clearSleep()
      void this.player.fadeOutAndPause(5000)
    }, Math.max(0, ms - 5000))
  }

  clearSleep() {
    if (this.sleepTimeout) clearTimeout(this.sleepTimeout)
    this.sleepTimeout = null
    usePlayback.setState({ sleep: { mode: 'off' } })
  }
}

let instance: Session | null = null
export function session(): Session {
  instance ??= new Session()
  return instance
}
export type { Session }
