import type { LookupApp } from '@/features/reader/lookup'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_SKIP, type PronunciationEntry, type SkipOptions } from '@/engine/text/types'

export type Theme = 'light' | 'sepia' | 'dark' | 'system'
export type FontFamily = 'serif' | 'sans' | 'dyslexic'
export type Margin = 'narrow' | 'normal' | 'wide'

export interface Settings {
  /** where "Look up" sends a selected word (device-specific, not synced) */
  lookup: LookupApp
  /** phones: Android's own selection (handles + system menu, e.g. ColorDict popup) or Lumen's long-press selection */
  touchSelection: 'android' | 'lumen'
  theme: Theme
  fontSize: number
  fontFamily: FontFamily
  lineHeight: number
  margin: Margin
  speed: number
  highlightSentence: boolean
  highlightWord: boolean
  autoScroll: boolean
  skip: SkipOptions
  dictionary: PronunciationEntry[]
  pdfMode: 'original' | 'text'
  /** PDF Original: after scrolling by hand, settle with a page's top at the top of the screen */
  snapPages: boolean
  /** PDF Original: invert the rendered pages while the app theme is dark */
  darkPages: boolean
  /** ms timestamp of the last change to any synced field */
  updatedAt: number
}

export const DEFAULT_SETTINGS: Settings = {
  lookup: 'share',
  touchSelection: 'android',
  theme: 'system',
  fontSize: 19,
  fontFamily: 'serif',
  lineHeight: 1.6,
  margin: 'normal',
  speed: 1,
  highlightSentence: true,
  highlightWord: true,
  autoScroll: true,
  skip: DEFAULT_SKIP,
  dictionary: [],
  pdfMode: 'original',
  snapPages: false,
  darkPages: true,
  updatedAt: 0,
}

/** Settings that stay on this device (not part of sync.json). */
const LOCAL_ONLY = new Set<string>(['pdfMode'])

interface SettingsStore extends Settings {
  set: (patch: Partial<Settings>) => void
  /** apply settings that came from sync without bumping updatedAt */
  replace: (s: Settings) => void
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      // only synced fields bump updatedAt, else a device-local change (PDF view mode) would make
      // stale synced values win the last-write-wins merge
      set: (patch) => set(Object.keys(patch).some((k) => !LOCAL_ONLY.has(k)) ? { ...patch, updatedAt: Date.now() } : patch),
      replace: (s) => set({ ...DEFAULT_SETTINGS, ...s }),
    }),
    { name: 'lumen-settings', version: 1 },
  ),
)

export function settingsSnapshot(): Settings {
  const { set: _s, replace: _r, ...rest } = useSettings.getState()
  return rest
}

/** Resolve "system" to a concrete theme and apply it to <html data-theme>. */
export function applyTheme(theme: Theme) {
  const dark = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
  const t = theme === 'system' ? (dark ? 'dark' : 'light') : theme
  document.documentElement.dataset.theme = t
  const color = t === 'dark' ? '#111318' : t === 'sepia' ? '#F6EFDF' : '#FFFFFF'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color)
}
