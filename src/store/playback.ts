import { create } from 'zustand'
import type { PlayerState } from '../engine/tts/player'

export interface ModelStatus {
  status: 'idle' | 'downloading' | 'loading' | 'ready' | 'error'
  fraction: number | null
  loadedBytes: number
  totalBytes: number
  error?: string
}

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
  rtf?: number
  sleep: SleepTimer
  error?: string
}

export const usePlayback = create<PlaybackState>()(() => ({
  bookId: null,
  title: '',
  state: 'idle',
  index: 0,
  count: 0,
  section: 0,
  speed: 1,
  model: { status: 'idle', fraction: null, loadedBytes: 0, totalBytes: 0 },
  sleep: { mode: 'off' },
}))
