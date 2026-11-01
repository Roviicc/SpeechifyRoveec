import { FakeTtsBackend } from './fakeBackend'
import { KokoroBackend } from './kokoroBackend'
import type { TtsBackend } from './types'

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
  return isFakeVoice() ? new FakeTtsBackend() : new KokoroBackend()
}
