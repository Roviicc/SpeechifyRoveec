import type { SleepTimer as SleepState } from '@/state/playback'

export type SleepMode = 'off' | 'chapter' | number

/** Fade length when the minutes timer runs out / when "end of chapter" is reached. */
export const SLEEP_FADE_MS = 5000
export const CHAPTER_FADE_MS = 3000

export interface SentenceStep {
  prevIndex: number
  prevSection: number
  index: number
  section: number
  /** player is playing / buffering */
  active: boolean
}

/** "End of chapter" fires only when reading on naturally into the next section, not when the user jumps. */
export function reachedChapterEnd(mode: SleepState['mode'], step: SentenceStep): boolean {
  return mode === 'chapter' && step.active && step.section !== step.prevSection && step.index === step.prevIndex + 1
}

export interface SleepTimerDeps {
  /** fade the volume out over `ms`, then pause */
  fadeOut(ms: number): void
  /** publish the timer state (to the playback store) */
  publish(state: SleepState): void
  getState(): SleepState
  now?: () => number
}

/** Sleep timer: N minutes (fading out over the last 5 s) or the end of the current chapter. */
export class SleepTimer {
  private timeout: ReturnType<typeof setTimeout> | null = null

  constructor(private deps: SleepTimerDeps) {}

  set(mode: SleepMode) {
    this.clear()
    if (mode === 'off') return
    if (mode === 'chapter') {
      this.deps.publish({ mode: 'chapter' })
      return
    }
    const ms = mode * 60_000
    const now = this.deps.now?.() ?? Date.now()
    this.deps.publish({ mode: 'minutes', minutes: mode, endsAt: now + ms })
    this.timeout = setTimeout(() => {
      this.clear()
      this.deps.fadeOut(SLEEP_FADE_MS)
    }, Math.max(0, ms - SLEEP_FADE_MS))
  }

  clear() {
    if (this.timeout) clearTimeout(this.timeout)
    this.timeout = null
    this.deps.publish({ mode: 'off' })
  }

  /** Call on every sentence change; stops at the start of the next chapter when that mode is on. */
  onSentence(step: SentenceStep) {
    if (!reachedChapterEnd(this.deps.getState().mode, step)) return
    this.clear()
    this.deps.fadeOut(CHAPTER_FADE_MS)
  }
}
