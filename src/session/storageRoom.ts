/** Prepared audio never grows beyond this (Opus speech is ~11 MB per hour, so this is many books). */
export const PREPARED_LIMIT = 4 * 1024 ** 3
/** Keep at least this much of the browser's quota free for everything else. */
const MIN_FREE = 200 * 1024 ** 2

/** Whether there is room for more prepared audio: under our own cap and the browser's quota (navigator.storage.estimate). */
export async function hasRoomForPrepared(preparedTotal: () => Promise<number>): Promise<boolean> {
  if ((await preparedTotal().catch(() => 0)) >= PREPARED_LIMIT) return false
  const est = await navigator.storage?.estimate?.().catch(() => null)
  if (!est?.quota) return true
  const free = est.quota - (est.usage ?? 0)
  return free > MIN_FREE && (est.usage ?? 0) / est.quota < 0.95
}

/** Bytes of stored audio per second: Opus at 24 kbit/s, or 16-bit 24 kHz WAV where Opus can't be encoded. */
export function audioBytesPerSecond(opus: boolean): number {
  return opus ? 3000 : 48000
}
