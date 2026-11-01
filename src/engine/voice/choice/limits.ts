/** Speed thresholds and time limits for starting a voice. RTF = generation time / audio length. */

/** GPU must generate at least this fast or 'auto' falls back to the CPU. */
export const GPU_MAX_RTF = 1
/** Kokoro must generate at least this fast in its start-up test, or the Auto voice switches to Piper. */
export const KOKORO_MAX_RTF = 0.9

/** If the GPU hasn't finished its speed test after this long, it is treated as too slow. */
export const GPU_TEST_TIMEOUT_MS = 30_000
/** Processor speed test must finish within this (generous: slow phones run at RTF ~3). */
export const CPU_TEST_TIMEOUT_MS = 75_000
/** No message at all from the worker for this long (download or load stalled) -> give up on this attempt. */
export const SILENCE_TIMEOUT_MS = 90_000
