/**
 * "GPU usage while preparing" as a duty cycle: after a background sentence that took `synthMs` to generate, rest
 * for synthMs × (100/usage − 1). At 100% there is no rest; at 50% the voice works half of the time; at 20% a fifth.
 */
export function restAfter(synthMs: number, usagePercent: number): number {
  if (!(synthMs > 0)) return 0
  const u = Math.min(100, Math.max(1, Number.isFinite(usagePercent) ? usagePercent : 100))
  return synthMs * (100 / u - 1)
}

export interface PrepareStats {
  /** sentences generated per minute (all workers together) */
  perMin: number
  /** seconds of audio generated per second of wall time ("×11 real time") */
  xRealtime: number
  /** wall milliseconds per spoken character (for the time left) */
  msPerChar: number
}

/**
 * Measured preparing speed over the last minute (wall time, so rests and parallel workers are both accounted for).
 * Events older than the window are dropped; the window then starts at the newest dropped event.
 */
export class Throughput {
  private events: Array<{ t: number; chars: number; audio: number }> = []
  private base: number | null = null

  constructor(private readonly windowMs = 60_000) {}

  /** Mark the start of measuring (first generation of a run). Later calls keep the first mark. */
  start(now: number) {
    this.base ??= now
  }

  reset() {
    this.events = []
    this.base = null
  }

  add(chars: number, audioSec: number, now: number) {
    this.start(now)
    this.events.push({ t: now, chars, audio: audioSec })
    while (this.events.length > 1 && now - this.events[0].t > this.windowMs) this.base = this.events.shift()!.t
  }

  stats(): PrepareStats | null {
    const last = this.events.at(-1)
    if (!last || this.base === null) return null
    const ms = last.t - this.base
    const chars = this.events.reduce((a, e) => a + e.chars, 0)
    if (ms <= 0 || chars <= 0) return null
    const audio = this.events.reduce((a, e) => a + e.audio, 0)
    return { perMin: (this.events.length * 60_000) / ms, xRealtime: (audio * 1000) / ms, msPerChar: ms / chars }
  }
}

/** "×11 real time" style label (one decimal below 10). */
export function formatRealtime(x: number): string {
  return `×${x >= 10 ? Math.round(x) : x.toFixed(1)} real time`
}
