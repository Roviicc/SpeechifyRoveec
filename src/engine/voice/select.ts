import { FakeTtsBackend } from './fakeBackend'
import { SwitchingBackend } from './switchingBackend'
import { KokoroBackend } from './kokoro/backend'
import type { TtsBackend, TtsInfo, VoiceModel } from './types'

/** `?tts=fake` or VITE_TTS=fake selects the instant silent voice (used by e2e tests). */
export function isFakeVoice(): boolean {
  if (import.meta.env.VITE_TTS === 'fake') return true
  try {
    const q = new URLSearchParams(location.search).get('tts')
    if (q === 'fake') sessionStorage.setItem('tts', 'fake')
    if (q === 'real') sessionStorage.removeItem('tts')
    return sessionStorage.getItem('tts') === 'fake'
  } catch {
    return false
  }
}

export function createBackend(): TtsBackend {
  return isFakeVoice() ? new FakeTtsBackend() : new SwitchingBackend()
}

/**
 * Whether extra preparing workers ("Turbo") may run next to the main voice: only the Natural voice on the GPU
 * (and the fake voice in tests). Never on the processor, where a second worker would only fight for the same cores.
 */
export function turboAllowed(info: TtsInfo | null, voice: VoiceModel): boolean {
  if (!info || voice !== 'kokoro') return false
  return info.device === 'webgpu' || info.device === 'fake'
}

/** A separate voice instance for an extra preparing lane, matching the main voice (null when not allowed). */
export function createPrepareWorker(info: TtsInfo | null, voice: VoiceModel): TtsBackend | null {
  if (!turboAllowed(info, voice)) return null
  return info!.device === 'fake' ? new FakeTtsBackend() : new KokoroBackend({ only: 'webgpu' })
}
