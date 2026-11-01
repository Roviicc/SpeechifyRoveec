import { encodeWav } from './wav'
import { CancelledError, type GeneratedAudio, type LoadProgress, type TtsBackend, type TtsInfo } from './types'

/**
 * Instant, deterministic silent voice: 60 ms per character (min 300 ms).
 * Used by e2e tests (?tts=fake) so they never download the model.
 */
export class FakeTtsBackend implements TtsBackend {
  info: TtsInfo | null = null
  private epoch = 0
  calls: string[] = []
  constructor(private readonly opts: { msPerChar?: number; delayMs?: number; sampleRate?: number } = {}) {}

  async init(onProgress?: (p: LoadProgress) => void): Promise<TtsInfo> {
    onProgress?.({ fraction: 1, loadedBytes: 0, totalBytes: 0, status: 'ready' })
    this.info = { device: 'fake', dtype: 'none' }
    return this.info
  }

  static durationFor(text: string, msPerChar = 60): number {
    return Math.max(0.3, (text.length * msPerChar) / 1000)
  }

  async generate(text: string, epoch: number): Promise<GeneratedAudio> {
    this.calls.push(text)
    const t0 = performance.now()
    if (this.opts.delayMs) await new Promise((r) => setTimeout(r, this.opts.delayMs))
    if (epoch < this.epoch) throw new CancelledError()
    const duration = FakeTtsBackend.durationFor(text, this.opts.msPerChar)
    const rate = this.opts.sampleRate ?? 8000
    const wav = new Blob([encodeWav(new Float32Array(Math.round(duration * rate)), rate)], { type: 'audio/wav' })
    return { wav, duration, genMs: performance.now() - t0 }
  }

  cancel(epoch: number): void {
    this.epoch = Math.max(this.epoch, epoch)
  }
}
