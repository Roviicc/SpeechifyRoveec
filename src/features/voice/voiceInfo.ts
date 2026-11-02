import type { VoiceModel } from '@/engine/voice/types'
import { VOICE_DOWNLOAD_BYTES } from '@/engine/voice/install'

export interface VoiceInfo {
  id: VoiceModel
  name: string
  engine: string
  blurb: string
  bytes: number
}

export const VOICES: Record<VoiceModel, VoiceInfo> = {
  kokoro: { id: 'kokoro', name: 'Natural', engine: 'Kokoro', blurb: 'Most lifelike. Needs a fast phone or computer.', bytes: VOICE_DOWNLOAD_BYTES.kokoro },
  piper: { id: 'piper', name: 'Fast', engine: 'Piper', blurb: 'Clear and light. Smooth on most phones.', bytes: VOICE_DOWNLOAD_BYTES.piper },
}

/** Cellular connection (Chrome on Android exposes navigator.connection.type). */
export function onMobileData(): boolean {
  const c = (navigator as Navigator & { connection?: { type?: string } }).connection
  return c?.type === 'cellular'
}
