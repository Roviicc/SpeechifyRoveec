import type { GeneratedAudio } from '@/engine/voice/types'
import { CancelledError } from '@/engine/voice/types'

/** A range of sentences to generate ahead ("Prepare" in Contents). `to` is inclusive. */
export interface PrepareJob {
  id: number
  bookId: string
  /** what the UI calls it: a chapter title or "Whole book" */
  label: string
  from: number
  to: number
}

export interface PrepareProgress {
  job: PrepareJob
  /** sentences of the range that have audio (including those that already had it) */
  done: number
  total: number
  /** estimated seconds left, from the measured speed (null until known) */
  etaSec: number | null
}

export interface PreparerState {
  current: PrepareProgress | null
  /** waiting jobs, in order */
  queue: PrepareJob[]
  /** why the last run stopped early (storage full, voice failed...) */
  error?: string
}

export interface PrepareStore {
  lookup(bookId: string, items: Array<{ index: number; text: string }>, voice: string): Promise<{ cached: Set<number>; prepared: Set<number> }>
  putPrepared(bookId: string, index: number, text: string, blob: Blob, duration: number, voice: string): Promise<void>
  markPrepared(bookId: string, indexes: number[]): Promise<void>
}

export interface PreparerDeps {
  /** low-priority generation (yields to the player) */
  generate(text: string): Promise<GeneratedAudio>
  store: PrepareStore
  /** voice id mixed into the cache hash (the same one the player's store uses) */
  voice(): string
  /** spoken text of every sentence of the book, exactly as the player reads it */
  sentences(bookId: string): Promise<string[]>
  /** false when storage is (nearly) full */
  hasRoom?(): Promise<boolean>
  /** first guess of generation milliseconds per spoken character, before anything is measured */
  msPerCharGuess?(): number
  /** a sentence got prepared (or was found cached) */
  onSentence?(bookId: string, index: number): void
  /** rest after each generated sentence, as a multiple of its generation time (0 = full speed) */
  restFactor?(): number
  /** wait before retrying a failed sentence */
  retryDelayMs?: number
}

export class StorageFullError extends Error {
  constructor() {
    super('Storage is full. Free some space (Settings → Storage) to prepare more audio.')
    this.name = 'StorageFullError'
  }
}

const isQuotaError = (e: unknown) => {
  const n = (e as { name?: string; inner?: { name?: string } })?.name
  return n === 'QuotaExceededError' || (e as { inner?: { name?: string } })?.inner?.name === 'QuotaExceededError'
}

/** How often (sentences) to look at the storage estimate. */
const ROOM_CHECK_EVERY = 20

/**
 * Generates a book's audio ahead of time, one range at a time (a queue), into the same audio cache the player reads,
 * so playback later needs no generation at all. Already cached sentences are skipped; skipped text never becomes a
 * sentence, so it is never generated. Work goes through the voice's background lane, behind the player's requests.
 */
export class Preparer {
  private state: PreparerState = { current: null, queue: [] }
  private listeners = new Set<(s: PreparerState) => void>()
  private nextId = 1
  private running = false
  /** id of the job being run; set to null to stop it */
  private runningJob: number | null = null
  /** measured generation wall-time per spoken character (rolling) */
  private msPerChar: number | null = null

  constructor(private readonly deps: PreparerDeps) {}

  get snapshot(): PreparerState {
    return this.state
  }

  subscribe(fn: (s: PreparerState) => void): () => void {
    this.listeners.add(fn)
    fn(this.state)
    return () => this.listeners.delete(fn)
  }

  private set(patch: Partial<PreparerState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((fn) => fn(this.state))
  }

  /** Queue a range (ignored if the same range is already queued or running). Returns the job id. */
  enqueue(bookId: string, from: number, to: number, label: string): number {
    const same = (j: PrepareJob) => j.bookId === bookId && j.from === from && j.to === to
    const existing = this.state.current && same(this.state.current.job) ? this.state.current.job : this.state.queue.find(same)
    if (existing) return existing.id
    const job: PrepareJob = { id: this.nextId++, bookId, label, from, to }
    this.set({ queue: [...this.state.queue, job], error: undefined })
    void this.pump()
    return job.id
  }

  /** Cancel one job (queued or running), or everything when no id is given. */
  cancel(id?: number) {
    if (id === undefined) {
      this.runningJob = null
      this.set({ queue: [], current: null })
      return
    }
    if (this.state.current?.job.id === id) {
      this.runningJob = null
      this.set({ current: null })
    } else this.set({ queue: this.state.queue.filter((j) => j.id !== id) })
  }

  /** Drop every job of a book (e.g. its prepared audio was deleted). */
  cancelBook(bookId: string) {
    if (this.state.current?.job.bookId === bookId) this.cancel(this.state.current.job.id)
    this.set({ queue: this.state.queue.filter((j) => j.bookId !== bookId) })
  }

  /** Resolves when the queue is empty (for tests). */
  idle(): Promise<void> {
    if (!this.running) return Promise.resolve()
    return new Promise((resolve) => {
      const off = this.subscribe((s) => {
        if (!s.current && !s.queue.length && !this.running) {
          off()
          resolve()
        }
      })
    })
  }

  private async pump() {
    if (this.running) return
    this.running = true
    try {
      while (this.state.queue.length) {
        const [job, ...rest] = this.state.queue
        this.runningJob = job.id
        this.set({ queue: rest, current: { job, done: 0, total: Math.max(0, job.to - job.from + 1), etaSec: null } })
        try {
          await this.runJob(job)
        } catch (e) {
          if (e instanceof StorageFullError) {
            // nothing else fits either
            this.set({ queue: [], error: e.message })
          } else if (!(e instanceof CancelledError)) {
            this.set({ error: `Could not prepare ${job.label}: ${(e as Error)?.message ?? e}` })
          }
        }
        if (this.state.current?.job.id === job.id) this.set({ current: null })
      }
    } finally {
      this.running = false
      this.runningJob = null
      this.set({})
    }
  }

  private alive(job: PrepareJob) {
    if (this.runningJob !== job.id) throw new CancelledError()
  }

  private progress(job: PrepareJob, done: number, total: number, remainingChars: number) {
    if (this.runningJob !== job.id) return
    const rate = this.msPerChar ?? this.deps.msPerCharGuess?.() ?? null
    this.set({ current: { job, done, total, etaSec: rate === null ? null : (remainingChars * rate) / 1000 } })
  }

  private async runJob(job: PrepareJob) {
    const texts = await this.deps.sentences(job.bookId)
    this.alive(job)
    const from = Math.max(0, job.from)
    const to = Math.min(texts.length - 1, job.to)
    const items: Array<{ index: number; text: string }> = []
    for (let i = from; i <= to; i++) if (texts[i]) items.push({ index: i, text: texts[i] })
    const total = items.length

    // the voice can change half way (Settings → Voice): start over with the new voice's cache entries
    for (;;) {
      const voice = this.deps.voice()
      const { cached, prepared } = await this.deps.store.lookup(job.bookId, items, voice)
      this.alive(job)
      const unpinned = [...cached].filter((i) => !prepared.has(i))
      await this.deps.store.markPrepared(job.bookId, unpinned)
      cached.forEach((i) => this.deps.onSentence?.(job.bookId, i))
      const todo = items.filter((it) => !cached.has(it.index))
      let done = total - todo.length
      let remainingChars = todo.reduce((a, it) => a + it.text.length, 0)
      this.progress(job, done, total, remainingChars)

      let voiceChanged = false
      for (let k = 0; k < todo.length; k++) {
        const it = todo[k]
        let rest = 0
        this.alive(job)
        if (k % ROOM_CHECK_EVERY === 0 && this.deps.hasRoom && !(await this.deps.hasRoom())) throw new StorageFullError()
        // the player may have made this one meanwhile (it reads the same cache)
        const again = await this.deps.store.lookup(job.bookId, [it], voice)
        if (again.cached.has(it.index)) {
          if (!again.prepared.has(it.index)) await this.deps.store.markPrepared(job.bookId, [it.index])
        } else {
          const t0 = performance.now()
          const audio = await this.generateWithRetry(it.text, job)
          this.alive(job)
          if (this.deps.voice() !== voice) {
            voiceChanged = true
            break
          }
          try {
            await this.deps.store.putPrepared(job.bookId, it.index, it.text, audio.wav, audio.duration, voice)
          } catch (e) {
            if (isQuotaError(e)) throw new StorageFullError()
            throw e
          }
          // lighter settings rest in proportion to the pure synthesis time (live playback is never slowed)
          rest = audio.genMs * (this.deps.restFactor?.() ?? 0)
          this.measure(performance.now() - t0 + rest, it.text.length)
        }
        done++
        remainingChars -= it.text.length
        this.deps.onSentence?.(job.bookId, it.index)
        this.progress(job, done, total, remainingChars)
        if (rest > 0) await new Promise((r) => setTimeout(r, rest))
      }
      if (!voiceChanged) return
    }
  }

  private measure(ms: number, chars: number) {
    if (chars <= 0) return
    const sample = ms / chars
    this.msPerChar = this.msPerChar === null ? sample : this.msPerChar * 0.8 + sample * 0.2
  }

  private async generateWithRetry(text: string, job: PrepareJob): Promise<GeneratedAudio> {
    try {
      return await this.deps.generate(text)
    } catch {
      this.alive(job)
      // e.g. the engine was restarted (voice switch): one more try
      await new Promise((r) => setTimeout(r, this.deps.retryDelayMs ?? 1000))
      this.alive(job)
      return this.deps.generate(text)
    }
  }
}
