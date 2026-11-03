import { BACKGROUND_EPOCH } from './priorityBackend'
import { CancelledError, type GeneratedAudio, type TtsBackend } from './types'

/** Most voice workers preparing at once (the main voice + 2 extra). */
export const MAX_PREPARE_WORKERS = 3

export interface BackgroundLanesDeps {
  /**
   * A new, separate voice instance for an extra lane (its own worker, same device/dtype/model as the main voice),
   * or null when extra workers are not allowed (the main voice is not on the GPU).
   */
  create(): TtsBackend | null
  /** Resolves when the player has nothing running or pending (the lanes always yield to playback). */
  waitForPlayer(): Promise<void>
  /** An extra worker failed to load or crashed; `workers` is how many are still usable (1 = main voice only). */
  onFailed?(lane: number, workers: number, error: unknown): void
}

interface Lane {
  backend: TtsBackend
  ready: Promise<unknown>
  chain: Promise<unknown>
}

class LaneUnavailable extends Error {
  constructor(cause?: unknown) {
    super('extra voice worker unavailable', { cause })
    this.name = 'LaneUnavailable'
  }
}

/**
 * Extra voice workers used only for preparing audio ahead ("Turbo"): lane 1, 2... each is its own Kokoro worker
 * running beside the main voice, so several sentences are generated at once and the GPU stays busy while the
 * others do CPU work (phonemizing, reading audio back, encoding, writing). Workers start lazily on their first
 * sentence and are disposed when preparing ends or Turbo is turned down. A worker that fails to load (e.g. the GPU
 * is out of memory) lowers the cap so fewer workers are used from then on.
 */
export class BackgroundLanes {
  private lanes = new Map<number, Lane>()
  /** workers allowed after failures (main voice included) */
  private cap = MAX_PREPARE_WORKERS

  constructor(private readonly deps: BackgroundLanesDeps) {}

  /** How many workers can be used (main voice included), after any failures. */
  get limit(): number {
    return this.cap
  }

  /** Extra workers currently loaded or loading. */
  get running(): number {
    return this.lanes.size
  }

  /** Generate on extra lane `lane` (>= 1): one sentence at a time per lane, after the player's requests. */
  generate(lane: number, text: string): Promise<GeneratedAudio> {
    if (lane < 1 || lane >= this.cap) return Promise.reject(new LaneUnavailable())
    let l = this.lanes.get(lane)
    if (!l) {
      const backend = this.deps.create()
      if (!backend) return Promise.reject(new LaneUnavailable())
      l = { backend, ready: backend.init(), chain: Promise.resolve() }
      // a load failure is handled where it is awaited
      l.ready.catch(() => {})
      this.lanes.set(lane, l)
    }
    const me = l
    const run = me.chain.then(async () => {
      try {
        await me.ready
      } catch (e) {
        this.fail(lane, me, e)
        throw new LaneUnavailable(e)
      }
      await this.deps.waitForPlayer()
      if (this.lanes.get(lane) !== me) throw new CancelledError()
      try {
        return await me.backend.generate(text, BACKGROUND_EPOCH)
      } catch (e) {
        if (!(e instanceof CancelledError)) this.fail(lane, me, e)
        throw e
      }
    })
    me.chain = run.catch(() => {})
    return run
  }

  private fail(lane: number, l: Lane, error: unknown) {
    if (this.lanes.get(lane) !== l) return
    this.cap = Math.max(1, Math.min(this.cap, lane))
    this.trim(this.cap)
    this.deps.onFailed?.(lane, this.cap, error)
  }

  /** Dispose extra workers so that at most `workers` (main voice included) remain. */
  trim(workers: number) {
    for (const [lane, l] of [...this.lanes]) {
      if (lane < workers) continue
      this.lanes.delete(lane)
      l.backend.reset?.()
    }
  }

  /** Dispose every extra worker (frees its memory). */
  dispose() {
    this.trim(1)
  }

  /** Forget earlier failures (e.g. after switching the voice engine). */
  resetLimit() {
    this.cap = MAX_PREPARE_WORKERS
  }
}
