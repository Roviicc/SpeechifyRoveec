import type { GeneratedAudio, LoadProgress, TtsBackend, TtsInfo } from '@/engine/voice/types'
import { SILENCE_TIMEOUT_MS } from '@/engine/voice/choice/limits'
import { WorkerVoiceClient } from '@/engine/voice/shared/workerVoiceClient'

const STALLED = 'The voice download or start-up stopped. Check your connection and tap Retry.'

/** Piper (VITS) in a Web Worker: a lighter, much faster voice for phones where Kokoro can't keep up. */
export class PiperBackend implements TtsBackend {
  private client = new WorkerVoiceClient()
  private initPromise: Promise<TtsInfo> | null = null

  get info(): TtsInfo | null {
    return this.client.info
  }

  init(onProgress?: (p: LoadProgress) => void): Promise<TtsInfo> {
    this.initPromise ??= this.client
      .launch(
        () => new Worker(new URL('./piper.worker.ts', import.meta.url), { type: 'module' }),
        {
          init: { type: 'init', device: 'wasm', dtype: 'q8' },
          // one generous limit for every stage, the speed test included
          silenceMs: SILENCE_TIMEOUT_MS * 2,
          silenceError: () => new Error(STALLED),
          testTimeoutMs: SILENCE_TIMEOUT_MS * 2,
          testTimeoutError: () => new Error(STALLED),
          startError: (message) => new Error(message),
          crashError: (e) => new Error(e.message || 'Voice worker failed to start'),
        },
        onProgress,
      )
      .catch((e) => {
        this.initPromise = null
        throw e
      })
    return this.initPromise
  }

  async generate(text: string, epoch: number): Promise<GeneratedAudio> {
    await this.init()
    return this.client.generate(text, epoch)
  }

  cancel(epoch: number): void {
    this.client.cancel(epoch)
  }

  reset() {
    this.client.reset()
    this.initPromise = null
  }
}
