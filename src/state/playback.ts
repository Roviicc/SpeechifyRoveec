import { create } from 'zustand'
import type { PlayerState } from '@/engine/voice/player/player'
import type { TtsDevice, VoiceModel } from '@/engine/voice/types'

export interface ModelStatus {
  status: 'idle' | 'downloading' | 'loading' | 'ready' | 'error'
  fraction: number | null
  loadedBytes: number
  totalBytes: number
  error?: string
  /** loading a voice that is already stored on this device (so the UI says "Loading", not "Downloading") */
  fromDevice?: boolean
  /** which voice is loading */
  voice?: VoiceModel
}

export const IDLE_MODEL: ModelStatus = { status: 'idle', fraction: null, loadedBytes: 0, totalBytes: 0 }

export interface SleepTimer {
  mode: 'off' | 'minutes' | 'chapter'
  endsAt?: number
  minutes?: number
}

export interface PlaybackState {
  bookId: string | null
  title: string
  cover?: string
  state: PlayerState
  index: number
  count: number
  section: number
  speed: number
  model: ModelStatus
  device?: string
  /** what the loaded voice runs on (webgpu / wasm / fake) */
  engineDevice?: TtsDevice
  /** worker is cross-origin isolated (WASM threads possible) */
  isolated?: boolean
  /** WASM threads used by the voice */
  threads?: number
  rtf?: number
  sleep: SleepTimer
  error?: string
  /** a first-time voice download is waiting for the user's OK (shown as a sheet) */
  downloadPrompt?: VoiceModel | null
}

export const usePlayback = create<PlaybackState>()(() => ({
  bookId: null,
  title: '',
  state: 'idle',
  index: 0,
  count: 0,
  section: 0,
  speed: 1,
  model: { ...IDLE_MODEL },
  sleep: { mode: 'off' },
}))
