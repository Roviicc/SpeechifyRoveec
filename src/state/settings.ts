import type { LookupApp } from '@/features/reader/lookup'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_SKIP, type PronunciationEntry, type SkipOptions } from '@/engine/text/types'

export type Theme = 'light' | 'sepia' | 'dark' | 'system'
export type FontFamily = 'serif' | 'sans' | 'dyslexic'
export type Margin = 'narrow' | 'normal' | 'wide'
/** Background voice workers while preparing: 1 = normal, 2-3 = Turbo (extra GPU workers, WebGPU only). */
export type PrepareWorkers = 1 | 2 | 3

export const PREPARE_USAGE_MIN = 20
export const PREPARE_USAGE_MAX = 100

/** Clamp a "GPU usage while preparing" value to 20..100 in steps of 10. */
export function clampUsage(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return PREPARE_USAGE_MAX
  return Math.min(PREPARE_USAGE_MAX, Math.max(PREPARE_USAGE_MIN, Math.round(n / 10) * 10))
}

/** The old Full / Balanced / Light preparing speed, as a GPU usage percentage. */
const OLD_SPEED_USAGE: Record<string, number> = { full: 100, balanced: 70, light: 40 }

/**
 * Upgrade persisted settings from older versions: v1 had `prepareSpeed` ('full' | 'balanced' | 'light'), which
 * becomes `prepareUsage` (100 / 70 / 40).
 */
export function migrateSettings(persisted: unknown, version: number): Record<string, unknown> {
  const s = { ...((persisted as Record<string, unknown>) ?? {}) }
  if (version < 2) {
    const old = s.prepareSpeed
    delete s.prepareSpeed
    if (typeof old === 'string' && old in OLD_SPEED_USAGE) s.prepareUsage = OLD_SPEED_USAGE[old]
  }
  if ('prepareUsage' in s) s.prepareUsage = clampUsage(s.prepareUsage)
  if ('prepareWorkers' in s && ![1, 2, 3].includes(s.prepareWorkers as number)) s.prepareWorkers = 1
  return s
}

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
  /**
   * "GPU usage while preparing", 20..100 (%): a duty cycle. After each background sentence the preparer rests for
   * synthesis time × (100/usage − 1), so 50% works half the time (cooler, quieter, less battery).
   */
  prepareUsage: number
  /** voice workers used for preparing (2-3 = Turbo: extra Kokoro GPU workers run in parallel; WebGPU only) */
  prepareWorkers: PrepareWorkers
  /** share prepared audio between devices through Google Drive (when Drive is connected) */
  shareAudio: boolean
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
  prepareUsage: 100,
  prepareWorkers: 1,
  shareAudio: true,
  updatedAt: 0,
}

/** Settings that stay on this device (not part of sync.json). */
const LOCAL_ONLY = new Set<string>(['pdfMode', 'prepareUsage', 'prepareWorkers', 'shareAudio'])

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
    { name: 'lumen-settings', version: 2, migrate: (persisted, version) => migrateSettings(persisted, version) as unknown as SettingsStore },
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
