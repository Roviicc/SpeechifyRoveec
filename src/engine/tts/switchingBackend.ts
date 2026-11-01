import { KokoroBackend } from './kokoroBackend'
import { PiperBackend } from './piperBackend'
import { getVoiceModel } from './engineChoice'
import type { GeneratedAudio, LoadProgress, TtsBackend, TtsInfo, VoiceModel } from './types'

/** Delegates to Kokoro (natural) or Piper (fast) according to the Voice setting; reset() picks it up again. */
export class SwitchingBackend implements TtsBackend {
  private kokoro = new KokoroBackend()
  private piper = new PiperBackend()
  private current: TtsBackend = this.pick()

  private pick(): TtsBackend {
    return getVoiceModel() === 'piper' ? this.piper : this.kokoro
  }

  get voice(): VoiceModel {
    return this.current === this.piper ? 'piper' : 'kokoro'
  }

  get info(): TtsInfo | null {
    return this.current.info
  }

  init(onProgress?: (p: LoadProgress) => void): Promise<TtsInfo> {
    return this.current.init(onProgress)
  }

  generate(text: string, epoch: number): Promise<GeneratedAudio> {
    return this.current.generate(text, epoch)
  }

  cancel(epoch: number): void {
    this.current.cancel(epoch)
  }

  reset() {
    this.kokoro.reset()
    this.piper.reset()
    this.current = this.pick()
  }
}
