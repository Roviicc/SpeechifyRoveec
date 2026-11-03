import { readPref, writePref } from './prefsStorage'

// The voice-model choice and the time limits live in their own modules; re-exported so existing imports keep working.
export * from './voiceChoice'
export * from './limits'

type Device = 'webgpu' | 'wasm'

/**
 * Stored by older versions: the Natural voice's engine choice ('auto' | 'gpu' | 'cpu') and what 'auto' found out.
 * The Natural voice now always runs on the GPU when there is one (falling back to the processor only when the GPU
 * is missing or fails), so both are simply removed.
 */
const OLD_PREF_KEY = 'lumen-voice-engine'
const OLD_AUTO_KEY = 'lumen-voice-auto'
const SINGLE_THREAD_KEY = 'lumen-voice-single-thread'

/** Forget the old Auto / GPU / Processor engine choice: everyone gets the GPU now. */
export function migrateEnginePrefs() {
  writePref(OLD_PREF_KEY, null)
  writePref(OLD_AUTO_KEY, null)
}

/** Remembered when multi-threaded WASM hung on this device. */
export function singleThreadOnly(): boolean {
  return readPref(SINGLE_THREAD_KEY) === '1'
}
export function setSingleThreadOnly(v: boolean) {
  writePref(SINGLE_THREAD_KEY, v ? '1' : null)
}

export interface Attempt {
  device: Device
  /** WASM thread count to force (1 = single thread); undefined = default */
  threads?: number
}

/**
 * Ordered list of engines to try: each is used only if the previous one fails or stalls. The GPU comes first
 * whenever this device has a WebGPU adapter (no speed test: a slow GPU stays on the GPU); the processor is the
 * silent fallback.
 */
export function attemptChain(gpuAvailable: boolean, singleThread: boolean): Attempt[] {
  const cpu: Attempt[] = singleThread ? [{ device: 'wasm', threads: 1 }] : [{ device: 'wasm' }, { device: 'wasm', threads: 1 }]
  return gpuAvailable ? [{ device: 'webgpu' }, ...cpu] : cpu
}
