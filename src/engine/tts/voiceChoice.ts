import { readPref, writePref } from './prefsStorage'
import type { VoiceModel } from './types'

/** Voice setting: Auto (Kokoro if this device is fast enough, else Piper), or a fixed choice. */
export type VoicePref = 'auto' | VoiceModel

const MODEL_KEY = 'lumen-voice-model'
const AUTO_VOICE_KEY = 'lumen-voice-auto-model'

const asVoice = (v: string | null): VoiceModel | null => (v === 'kokoro' || v === 'piper' ? v : null)

export function getVoicePref(): VoicePref {
  return asVoice(readPref(MODEL_KEY)) ?? 'auto'
}
export function setVoicePref(p: VoicePref) {
  writePref(MODEL_KEY, p === 'auto' ? null : p)
}

/** What Auto decided on this device (null = not tested yet). */
export function getAutoVoice(): VoiceModel | null {
  return asVoice(readPref(AUTO_VOICE_KEY))
}
export function setAutoVoice(v: VoiceModel | null) {
  writePref(AUTO_VOICE_KEY, v)
}

/** The voice that will actually be used. */
export function effectiveVoice(pref: VoicePref = getVoicePref(), auto = getAutoVoice()): VoiceModel {
  return pref === 'auto' ? (auto ?? 'kokoro') : pref
}

/** Auto should test Kokoro's speed (and fall back to Piper) only when nothing has been decided yet. */
export function shouldTestKokoro(pref: VoicePref = getVoicePref(), auto = getAutoVoice()): boolean {
  return pref === 'auto' && auto === null
}
