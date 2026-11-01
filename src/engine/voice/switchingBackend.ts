import { KokoroBackend } from '@/engine/voice/kokoro/backend'
import { PiperBackend } from '@/engine/voice/piper/backend'
import { effectiveVoice, setAutoVoice, shouldTestKokoro } from '@/engine/voice/choice/voiceChoice'
import { KOKORO_MAX_RTF } from '@/engine/voice/choice/limits'
import type { GeneratedAudio, LoadProgress, TtsBackend, TtsInfo, VoiceModel } from './types'

/**
 * Delegates to Kokoro (natural) or Piper (fast) according to the Voice setting.
 * In Auto mode on a new device it tries Kokoro first; if Kokoro's start-up speed test is too slow (or it fails
 * to start) it switches to Piper and remembers the decision. reset() re-reads the setting.
 */
export class SwitchingBackend implements TtsBackend {
  private kokoro = new KokoroBackend()
  private piper = new PiperBackend()
  private current: TtsBackend = this.pick()
  private initPromise: Promise<TtsInfo> | null = null

  private pick(): TtsBackend {
    return effectiveVoice() === 'piper' ? this.piper : this.kokoro
  }

  get voice(): VoiceModel {
    return this.current === this.piper ? 'piper' : 'kokoro'
  }

  get info(): TtsInfo | null {
    return this.current.info
  }

  init(onProgress?: (p: LoadProgress) => void): Promise<TtsInfo> {
    this.initPromise ??= this.start(onProgress).catch((e) => {
      this.initPromise = null
      throw e
    })
    return this.initPromise
  }

  private async start(onProgress?: (p: LoadProgress) => void): Promise<TtsInfo> {
    if (!shouldTestKokoro() || this.current !== this.kokoro) return this.current.init(onProgress)
    const info: TtsInfo | null = await this.kokoro.init(onProgress).catch(() => null)
    if (info && (info.testRtf ?? 0) <= KOKORO_MAX_RTF) {
      setAutoVoice('kokoro')
      return info
    }
    // too slow (or failed): use the fast voice from now on
    this.kokoro.reset()
    setAutoVoice('piper')
    this.current = this.piper
    const piperInfo = await this.piper.init(onProgress)
    return { ...piperInfo, autoSwitched: { kokoroRtf: info?.testRtf ?? null } }
  }

  async generate(text: string, epoch: number): Promise<GeneratedAudio> {
    await this.init()
    return this.current.generate(text, epoch)
  }

  cancel(epoch: number): void {
    this.current.cancel(epoch)
  }

  reset() {
    this.kokoro.reset()
    this.piper.reset()
    this.initPromise = null
    this.current = this.pick()
  }
}
