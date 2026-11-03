import type { GeneratedAudio, LoadProgress, TtsBackend, TtsInfo } from './types'

/**
 * Epoch of background requests. The player's cancel(epoch) drops queued requests whose epoch is lower; player epochs
 * count up from 0, so they never reach this and a seek never throws away background work.
 */
export const BACKGROUND_EPOCH = Number.MAX_SAFE_INTEGER

/** Resolve on a fresh task without timer throttling (setTimeout is clamped to >= 1 s in hidden tabs). */
function nextTask(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return new Promise((r) => setTimeout(r, 0))
  return new Promise((resolve) => {
    const ch = new MessageChannel()
    ch.port1.onmessage = () => {
      ch.port1.close()
      resolve()
    }
    ch.port2.postMessage(0)
  })
}

/**
 * Wraps the voice so that two kinds of work can share it: the player's requests (normal generate(), first) and
 * background requests (generateBackground(), e.g. preparing chapters ahead). A background request starts only when
 * no player request is running or about to run, and only one runs at a time, so playback waits at most for the one
 * background sentence already in the engine.
 */
export class PriorityBackend implements TtsBackend {
  private active = 0
  private waiters: Array<() => void> = []
  private bgChain: Promise<unknown> = Promise.resolve()

  constructor(
    readonly inner: TtsBackend,
    /** extra "player is busy" signal (e.g. a prefetch that is still reading the cache before it generates) */
    private readonly busy: () => boolean = () => false,
  ) {}

  get info(): TtsInfo | null {
    return this.inner.info
  }

  /** Voice of the inner backend (SwitchingBackend reports kokoro/piper). */
  get voice(): unknown {
    return (this.inner as { voice?: unknown }).voice
  }

  init(onProgress?: (p: LoadProgress) => void): Promise<TtsInfo> {
    return this.inner.init(onProgress)
  }

  async generate(text: string, epoch: number): Promise<GeneratedAudio> {
    this.active++
    try {
      return await this.inner.generate(text, epoch)
    } finally {
      this.active--
      if (!this.active) this.wake()
    }
  }

  cancel(epoch: number): void {
    this.inner.cancel(epoch)
  }

  reset() {
    this.inner.reset?.()
  }

  /** Player work is running or pending. */
  get playerBusy(): boolean {
    return this.active > 0 || this.busy()
  }

  /** Call when the external busy() signal may have turned false. */
  wake() {
    const w = this.waiters
    this.waiters = []
    w.forEach((f) => f())
  }

  /** Resolves when no player work is running or pending (background lanes wait for this before each sentence). */
  async waitForPlayer(): Promise<void> {
    for (;;) {
      while (this.playerBusy) {
        await new Promise<void>((r) => {
          this.waiters.push(r)
          // busy() has no event of its own: look again shortly
          if (!this.active) setTimeout(r, 50)
        })
      }
      // give the player a moment to queue its next request (cache read -> generate) before we take the engine
      await nextTask()
      if (!this.playerBusy) return
    }
  }

  /** Low-priority generation (one at a time, after the player's requests). */
  generateBackground(text: string): Promise<GeneratedAudio> {
    const run = this.bgChain.then(async () => {
      await this.waitForPlayer()
      return this.inner.generate(text, BACKGROUND_EPOCH)
    })
    this.bgChain = run.catch(() => {})
    return run
  }
}
