import type { GeneratedAudio } from '@/engine/voice/types'
import { CancelledError } from '@/engine/voice/types'
import { restAfter, Throughput, type PrepareStats } from './dutyCycle'

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
  /** measured speed of this run (null until a sentence was generated) */
  stats?: PrepareStats | null
  /** voice workers generating in parallel right now */
  workers?: number
}

export interface PreparerState {
  current: PrepareProgress | null
  /** waiting jobs, in order */
  queue: PrepareJob[]
  /** why the last run stopped early (storage full, voice failed...) */
  error?: string
  /** small remark about the run (e.g. an extra worker could not start, so fewer are used) */
  note?: string
}

export interface PrepareStore {
  lookup(bookId: string, items: Array<{ index: number; text: string }>, voice: string): Promise<{ cached: Set<number>; prepared: Set<number> }>
  putPrepared(bookId: string, index: number, text: string, blob: Blob, duration: number, voice: string): Promise<void>
  markPrepared(bookId: string, indexes: number[]): Promise<void>
}

export interface PreparerDeps {
  /**
   * Low-priority generation (yields to the player). `lane` 0 is the main voice; lanes 1.. are extra voice workers
   * ("Turbo"), each with one sentence in flight. A failing extra lane gives its sentence back and stops.
   */
  generate(text: string, lane: number): Promise<GeneratedAudio>
  /** how many lanes to run (re-read after every sentence; default 1) */
  lanes?(): number
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
  /** "GPU usage while preparing", 20..100 %: each lane rests synthesis time × (100/usage − 1) after a sentence */
  usage?(): number
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

/** State of one pass over a job's sentences, shared by its lanes. */
interface Run {
  job: PrepareJob
  voice: string
  total: number
  /** sentences still to generate, in order (a failed extra lane puts its sentence back in front) */
  pending: Array<{ index: number; text: string }>
  done: number
  remainingChars: number
  /** sentences taken so far (for the storage check) */
  picked: number
  lanes: Map<number, Promise<void>>
  /** extra lanes that failed in this run */
  broken: Set<number>
  stop: boolean
  voiceChanged: boolean
  failure: unknown
  speed: Throughput
}

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
  /** measured wall time per spoken character (all lanes together, rests included) */
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

  /** Show (or clear) a small remark about preparing, e.g. that fewer workers are used. */
  setNote(note?: string) {
    if (this.state.note !== note) this.set({ note })
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

  private progress(run: Run) {
    const { job } = run
    if (this.runningJob !== job.id) return
    const rate = this.msPerChar ?? this.deps.msPerCharGuess?.() ?? null
    this.set({
      current: {
        job,
        done: run.done,
        total: run.total,
        etaSec: rate === null ? null : (run.remainingChars * rate) / 1000,
        stats: run.speed.stats(),
        workers: Math.max(1, run.lanes.size),
      },
    })
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
      const run: Run = {
        job,
        voice,
        total,
        pending: todo,
        done: total - todo.length,
        remainingChars: todo.reduce((a, it) => a + it.text.length, 0),
        picked: 0,
        lanes: new Map(),
        broken: new Set(),
        stop: false,
        voiceChanged: false,
        failure: null,
        speed: new Throughput(),
      }
      this.progress(run)
      this.ensureLanes(run)
      while (run.lanes.size) await Promise.all([...run.lanes.values()])
      if (run.failure) throw run.failure
      if (!run.voiceChanged) return
    }
  }

  /** Lanes wanted right now (at least 1; extra lanes that failed in this run are not restarted). */
  private wantedLanes(run: Run): number {
    let n = Math.max(1, Math.floor(this.deps.lanes?.() ?? 1))
    while (n > 1 && run.broken.has(n - 1)) n--
    return n
  }

  /** Start missing lanes (Turbo switched on, or the run is starting). */
  private ensureLanes(run: Run) {
    if (run.stop) return
    const want = this.wantedLanes(run)
    for (let lane = 0; lane < want; lane++) {
      if (run.lanes.has(lane) || run.broken.has(lane) || !run.pending.length) continue
      const p = this.lane(run, lane)
        .catch((e) => {
          if (!run.failure) run.failure = e
          run.stop = true
        })
        .finally(() => run.lanes.delete(lane))
      run.lanes.set(lane, p)
    }
  }

  /** One lane: take the next sentence, generate, store, rest; until nothing is left (or the lane is not wanted). */
  private async lane(run: Run, lane: number) {
    const { job, voice } = run
    while (!run.stop && run.pending.length) {
      this.alive(job)
      // Turbo turned down: extra lanes finish their sentence and stop
      if (lane > 0 && lane >= this.wantedLanes(run)) return
      const it = run.pending.shift()!
      let rest = 0
      if (run.picked++ % ROOM_CHECK_EVERY === 0 && this.deps.hasRoom && !(await this.deps.hasRoom())) throw new StorageFullError()
      // the player may have made this one meanwhile (it reads the same cache)
      const again = await this.deps.store.lookup(job.bookId, [it], voice)
      if (again.cached.has(it.index)) {
        if (!again.prepared.has(it.index)) await this.deps.store.markPrepared(job.bookId, [it.index])
      } else {
        run.speed.start(performance.now())
        let audio: GeneratedAudio
        if (lane === 0) audio = await this.generateWithRetry(it.text, job)
        else {
          try {
            audio = await this.deps.generate(it.text, lane)
          } catch {
            this.alive(job)
            // an extra worker failed (e.g. no GPU memory for it): its sentence goes back, the other lanes carry on
            run.pending.unshift(it)
            run.broken.add(lane)
            this.progress(run)
            // the main lane may have finished already: make sure someone picks the sentence up
            queueMicrotask(() => this.ensureLanes(run))
            return
          }
        }
        this.alive(job)
        if (run.stop) {
          run.pending.unshift(it)
          return
        }
        if (this.deps.voice() !== voice) {
          run.voiceChanged = true
          run.stop = true
          return
        }
        try {
          await this.deps.store.putPrepared(job.bookId, it.index, it.text, audio.wav, audio.duration, voice)
        } catch (e) {
          if (isQuotaError(e)) throw new StorageFullError()
          throw e
        }
        // lower usage rests in proportion to the pure synthesis time (live playback is never slowed)
        rest = restAfter(audio.genMs, this.deps.usage?.() ?? 100)
        run.speed.add(it.text.length, audio.duration, performance.now())
        const st = run.speed.stats()
        if (st) this.msPerChar = st.msPerChar
      }
      run.done++
      run.remainingChars -= it.text.length
      this.deps.onSentence?.(job.bookId, it.index)
      this.progress(run)
      this.ensureLanes(run)
      if (rest > 0) await new Promise((r) => setTimeout(r, rest))
    }
  }

  private async generateWithRetry(text: string, job: PrepareJob): Promise<GeneratedAudio> {
    try {
      return await this.deps.generate(text, 0)
    } catch {
      this.alive(job)
      // e.g. the engine was restarted (voice switch): one more try
      await new Promise((r) => setTimeout(r, this.deps.retryDelayMs ?? 1000))
      this.alive(job)
      return this.deps.generate(text, 0)
    }
  }
}
