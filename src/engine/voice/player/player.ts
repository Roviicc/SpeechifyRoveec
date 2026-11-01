import { CancelledError, type TtsBackend } from '@/engine/voice/types'

/** The subset of HTMLAudioElement the player needs (a fake is used in unit tests). */
export interface AudioLike {
  src: string
  currentTime: number
  playbackRate: number
  preservesPitch: boolean
  volume: number
  readonly paused: boolean
  play(): Promise<void>
  pause(): void
  removeAttribute(name: string): void
  addEventListener(type: 'ended' | 'error', fn: () => void): void
}

export interface AudioStore {
  get(bookId: string, index: number, text: string): Promise<{ blob: Blob; duration: number } | null>
  put(bookId: string, index: number, text: string, blob: Blob, duration: number): Promise<void>
}

export interface PlayerSource {
  bookId: string
  count: number
  text(index: number): string
}

/** Offset into a sentence: seconds, or a fraction of its (not yet known) duration. */
export type SeekOffset = number | { fraction: number }

export type PlayerState = 'idle' | 'buffering' | 'playing' | 'paused' | 'ended' | 'error'

interface Chunk {
  url: string
  duration: number
}

type Events = {
  state: PlayerState
  sentence: number
  chunk: { index: number; duration: number }
  error: Error
  rtf: number
}

export interface PlayerOptions {
  backend: TtsBackend
  store?: AudioStore
  audio?: AudioLike
  prefetch?: number
  createUrl?: (b: Blob) => string
  revokeUrl?: (u: string) => void
}

/** Real-time-factor samples kept for the rolling average. */
const RTF_WINDOW = 20

/**
 * Sentence-by-sentence player. Generates audio for the current sentence and prefetches the
 * next N while it plays; speed is applied with playbackRate (no regeneration).
 *
 * Two counters guard against stale async work: `epoch` (bumped when queued generation becomes useless, e.g. a
 * jump; the backend drops older requests) and `token` (bumped by every user action, so an older play attempt
 * that resolves late does nothing).
 */
export class Player {
  state: PlayerState = 'idle'
  index = 0
  speed = 1
  private source: PlayerSource | null = null
  private readonly backend: TtsBackend
  private readonly store?: AudioStore
  private readonly audio: AudioLike
  private readonly createUrl: (b: Blob) => string
  private readonly revokeUrl: (u: string) => void
  private prefetchDepth: number
  /** largest depth ever used: audio already generated within it is kept even after the depth drops again */
  private retainDepth: number
  private ready = new Map<number, Chunk>()
  private pending = new Map<number, Promise<Chunk>>()
  private epoch = 0
  private token = 0
  /** sentence whose audio is loaded in the audio element (-1 = none) */
  private loadedIndex = -1
  /** where to start the current sentence when its audio isn't loaded yet */
  private pendingOffset: SeekOffset = 0
  private listeners: Partial<Record<keyof Events, Set<(v: never) => void>>> = {}
  private fadeTimer: ReturnType<typeof setInterval> | null = null
  private fadeDone: (() => void) | null = null
  private rtfSamples: number[] = []

  constructor(opts: PlayerOptions) {
    this.backend = opts.backend
    this.store = opts.store
    this.prefetchDepth = opts.prefetch ?? 3
    this.retainDepth = this.prefetchDepth
    this.createUrl = opts.createUrl ?? ((b) => URL.createObjectURL(b))
    this.revokeUrl = opts.revokeUrl ?? ((u) => URL.revokeObjectURL(u))
    this.audio = opts.audio ?? new Audio()
    this.audio.preservesPitch = true
    this.audio.addEventListener('ended', () => this.onEnded())
    this.audio.addEventListener('error', () => {
      if (this.audio.src) this.fail(new Error('Audio playback failed'))
    })
  }

  // ---- events ----

  on<K extends keyof Events>(ev: K, fn: (v: Events[K]) => void): () => void {
    const set = (this.listeners[ev] ??= new Set()) as Set<(v: Events[K]) => void>
    set.add(fn)
    return () => {
      set.delete(fn)
    }
  }

  private emit<K extends keyof Events>(ev: K, v: Events[K]) {
    ;(this.listeners[ev] as Set<(v: Events[K]) => void> | undefined)?.forEach((fn) => fn(v))
  }

  private setState(s: PlayerState) {
    if (this.state === s) return
    this.state = s
    this.emit('state', s)
  }

  // ---- read-only state ----

  get currentTime(): number {
    if (this.loadedIndex === this.index) return this.audio.currentTime
    return typeof this.pendingOffset === 'number' ? this.pendingOffset : 0
  }

  /** Duration of the current sentence's audio, if generated. */
  get duration(): number | null {
    return this.durationOf(this.index)
  }

  durationOf(index: number): number | null {
    return this.ready.get(index)?.duration ?? null
  }

  get isActive(): boolean {
    return this.state === 'playing' || this.state === 'buffering'
  }

  get sourceId(): string | null {
    return this.source?.bookId ?? null
  }

  /** Average real-time factor (generation time / audio time) over recent sentences. */
  get rtf(): number | null {
    if (!this.rtfSamples.length) return null
    return this.rtfSamples.reduce((a, b) => a + b, 0) / this.rtfSamples.length
  }

  /** How many sentences ahead to generate. */
  get prefetchAhead(): number {
    return this.prefetchDepth
  }

  // ---- source and audio management ----

  /** Load a new document. Stops playback. */
  setSource(source: PlayerSource, index = 0) {
    this.stopAudio()
    this.source = source
    this.bumpEpoch()
    this.releaseAudio()
    this.index = Math.max(0, Math.min(index, source.count - 1))
    this.pendingOffset = 0
    this.setState('idle')
    this.emit('sentence', this.index)
  }

  /** Drop all generated audio (after switching voices); playback position is kept. */
  dropAudio() {
    this.stopAudio()
    this.bumpEpoch()
    this.releaseAudio()
    this.pendingOffset = 0
    if (this.state !== 'idle') this.setState('paused')
  }

  /** Forget speed samples (after switching the voice engine). */
  resetRtf() {
    this.rtfSamples = []
  }

  /**
   * Change how many sentences ahead are generated (e.g. deeper while the screen is locked, when the browser
   * may throttle the page). Raising it while playing starts the extra generation right away.
   */
  setPrefetchDepth(n: number) {
    n = Math.max(0, Math.floor(n))
    if (n === this.prefetchDepth) return
    const deeper = n > this.prefetchDepth
    this.prefetchDepth = n
    this.retainDepth = Math.max(this.retainDepth, n)
    if (deeper && this.source && this.isActive) this.prefetch(this.index)
  }

  /** Release everything (used by tests). */
  destroy() {
    this.stopAudio()
    this.releaseAudio()
    this.listeners = {}
  }

  // ---- transport controls ----

  play() {
    if (!this.source) return
    // already playing: don't restart the sentence (e.g. a redundant lock-screen "play")
    if (this.state === 'buffering' || (this.state === 'playing' && !this.audio.paused)) return
    // paused by us, or by the system behind our back (audio focus loss): resume in place
    if ((this.state === 'paused' || this.state === 'playing') && this.loadedIndex === this.index) {
      const token = ++this.token
      this.audio.playbackRate = this.speed
      this.audio.play().then(
        () => token === this.token && this.setState('playing'),
        (e: Error) => {
          // interrupted by pause()/seek() (AbortError) or by a newer action: not an error
          if (token !== this.token || e?.name === 'AbortError') return
          if (e?.name === 'NotAllowedError') this.setState('paused')
          else this.fail(e)
        },
      )
      this.setState('playing')
      return
    }
    const start = this.state === 'ended' ? 0 : this.index
    void this.playIndex(start, this.pendingOffset)
  }

  pause() {
    this.token++
    this.cancelFade()
    if (this.loadedIndex === this.index) {
      this.pendingOffset = 0
      this.audio.pause()
    } else {
      this.loadedIndex = -1
    }
    if (this.state !== 'idle') this.setState('paused')
  }

  toggle() {
    if (this.isActive) this.pause()
    else this.play()
  }

  /** Jump to sentence `i` (optionally `offset` seconds into it). Keeps playing if playing. */
  seek(i: number, offset: SeekOffset = 0, autoplay?: boolean) {
    if (!this.source) return
    i = Math.max(0, Math.min(i, this.source.count - 1))
    const play = autoplay ?? this.isActive
    if (i !== this.index) this.bumpEpoch()
    if (play) {
      void this.playIndex(i, offset)
      return
    }
    this.stopAudio()
    this.token++
    this.pendingOffset = offset
    this.moveTo(i)
    if (this.state !== 'idle') this.setState('paused')
  }

  next() {
    if (this.source && this.index + 1 < this.source.count) this.seek(this.index + 1)
  }

  prev() {
    // like a music player: restart the sentence if we're more than 1.5 s in
    if (this.currentTime > 1.5 && this.loadedIndex === this.index) this.seek(this.index, 0)
    else this.seek(this.index - 1)
  }

  setSpeed(speed: number) {
    this.speed = Math.round(Math.max(0.5, Math.min(3, speed)) * 10) / 10
    this.audio.playbackRate = this.speed
    this.audio.preservesPitch = true
  }

  // ---- sleep-timer fade ----

  /** Gently fade the volume out over `ms`, then pause. */
  fadeOutAndPause(ms = 5000): Promise<void> {
    this.cancelFade()
    return new Promise((resolve) => {
      const steps = Math.max(1, Math.round(ms / 50))
      let n = 0
      this.fadeDone = resolve
      this.fadeTimer = setInterval(() => {
        n++
        this.audio.volume = Math.max(0, 1 - n / steps)
        if (n >= steps) {
          this.pause()
          this.audio.volume = 1
        }
      }, 50)
    })
  }

  /** Stop a fade in progress (restoring the volume) and settle its promise. */
  private cancelFade() {
    if (this.fadeTimer) {
      clearInterval(this.fadeTimer)
      this.fadeTimer = null
      this.audio.volume = 1
    }
    const done = this.fadeDone
    this.fadeDone = null
    done?.()
  }

  // ---- internals: playback ----

  private async playIndex(i: number, offset: SeekOffset = 0, keepFade = false) {
    if (!this.source || !this.source.count) return
    const token = ++this.token
    // a sleep-timer fade carries on across the natural advance to the next sentence
    if (!keepFade) this.cancelFade()
    this.audio.pause()
    this.loadedIndex = -1
    this.moveTo(i)
    this.pendingOffset = offset
    const readyChunk = this.ready.get(i)
    if (!readyChunk) this.setState('buffering')
    const current = readyChunk ? Promise.resolve(readyChunk) : this.ensure(i)
    this.prefetch(i)
    let chunk: Chunk
    try {
      chunk = await current
    } catch (e) {
      if (token === this.token && !(e instanceof CancelledError)) this.fail(e as Error)
      return
    }
    if (token !== this.token) return
    this.audio.src = chunk.url
    this.audio.playbackRate = this.speed
    this.audio.preservesPitch = true
    const sec = typeof offset === 'number' ? offset : offset.fraction * chunk.duration
    this.audio.currentTime = Math.max(0, Math.min(sec, chunk.duration - 0.05))
    this.loadedIndex = i
    this.pendingOffset = 0
    try {
      await this.audio.play()
    } catch (e) {
      if (token === this.token) {
        // autoplay blocked or interrupted: treat as paused
        if ((e as Error)?.name === 'NotAllowedError') this.setState('paused')
        else if ((e as Error)?.name !== 'AbortError') this.fail(e as Error)
      }
      return
    }
    if (token !== this.token) return
    this.setState('playing')
    this.prefetch(i)
  }

  private onEnded() {
    if (!this.source || this.loadedIndex !== this.index) return
    if (this.index + 1 < this.source.count) {
      void this.playIndex(this.index + 1, 0, true)
    } else {
      this.loadedIndex = -1
      this.setState('ended')
    }
  }

  /** Make `i` the current sentence (announcing it if it changed). */
  private moveTo(i: number) {
    if (this.index === i) return
    this.index = i
    this.emit('sentence', i)
  }

  private stopAudio() {
    this.cancelFade()
    this.audio.pause()
    this.loadedIndex = -1
  }

  private fail(e: Error) {
    this.emit('error', e)
    this.setState('error')
  }

  // ---- internals: generation ----

  /** Invalidate all queued generation (and any play attempt in flight). */
  private bumpEpoch() {
    this.epoch++
    this.token++
    this.pending.clear()
    this.backend.cancel(this.epoch)
  }

  /** Revoke and forget all generated audio. */
  private releaseAudio() {
    for (const c of this.ready.values()) this.revokeUrl(c.url)
    this.ready.clear()
  }

  private recordRtf(genMs: number, duration: number) {
    this.rtfSamples.push(genMs / 1000 / duration)
    if (this.rtfSamples.length > RTF_WINDOW) this.rtfSamples.shift()
    this.emit('rtf', this.rtf!)
  }

  /** Audio for sentence `i`: already generated, being generated, from the cache, or generated now. */
  private ensure(i: number): Promise<Chunk> {
    const have = this.ready.get(i)
    if (have) return Promise.resolve(have)
    const p = this.pending.get(i)
    if (p) return p
    const src = this.source!
    const epoch = this.epoch
    const text = src.text(i)
    const job = (async (): Promise<Chunk> => {
      let blob: Blob
      let duration: number
      const cached = await this.store?.get(src.bookId, i, text).catch(() => null)
      if (cached) {
        ;({ blob, duration } = cached)
      } else {
        if (epoch !== this.epoch) throw new CancelledError()
        const g = await this.backend.generate(text, epoch)
        blob = g.wav
        duration = g.duration
        if (duration > 0) this.recordRtf(g.genMs, duration)
        void this.store?.put(src.bookId, i, text, blob, duration).catch(() => {})
      }
      if (this.source !== src) throw new CancelledError()
      // a duplicate job (e.g. from before a seek) already produced this sentence: keep that
      // chunk, its URL may be the one playing right now
      const existing = this.ready.get(i)
      if (existing) return existing
      const chunk = { url: this.createUrl(blob), duration }
      this.ready.set(i, chunk)
      this.emit('chunk', { index: i, duration })
      return chunk
    })()
    this.pending.set(i, job)
    const forget = () => this.pending.get(i) === job && this.pending.delete(i)
    job.then(forget, forget)
    return job
  }

  private prefetch(from: number) {
    if (!this.source) return
    const last = Math.min(this.source.count - 1, from + this.prefetchDepth)
    for (let j = from + 1; j <= last; j++) this.ensure(j).catch(() => {})
    // forget audio we have moved past (or that is far ahead, e.g. after a jump back)
    const keepTo = from + this.retainDepth
    for (const [k, c] of this.ready) {
      if (k < from - 1 || k > keepTo) {
        this.revokeUrl(c.url)
        this.ready.delete(k)
      }
    }
  }
}
