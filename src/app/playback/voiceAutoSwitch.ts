import type { VoiceModel } from '../../engine/tts/types'
import type { VoicePref } from '../../engine/tts/engineChoice'

/** RTF x speed above this, after enough sentences, means Kokoro can't keep up. */
export const SLOW_RTF = 1.3
export const MIN_SAMPLES = 4

export type SlowVoiceAction = 'switch' | 'hint'

/** Auto switches to the fast voice right away; a fixed Natural choice only gets a hint. */
export function slowVoiceAction(pref: VoicePref): SlowVoiceAction {
  return pref === 'auto' ? 'switch' : 'hint'
}

/**
 * Watches RTF reports and says (once, until reset) when Kokoro is too slow on this device.
 * Pure: no player, no DOM.
 */
export class SlowVoiceDetector {
  private fired = false
  private samples = 0

  /** True the first time playback is judged too slow. */
  observe(rtf: number, speed: number, voice: VoiceModel): boolean {
    if (this.fired || voice !== 'kokoro') return false
    if (++this.samples < MIN_SAMPLES || rtf * speed <= SLOW_RTF) return false
    this.fired = true
    return true
  }

  /** Start over (after switching the engine). */
  reset() {
    this.fired = false
    this.samples = 0
  }
}
