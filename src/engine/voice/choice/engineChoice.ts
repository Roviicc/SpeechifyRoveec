import { readPref, writePref } from './prefsStorage'

// The voice-model choice and the time limits live in their own modules; re-exported so existing imports keep working.
export * from './voiceChoice'
export * from './limits'

/** Which hardware runs the Kokoro voice. 'auto' tests the GPU once and remembers whether it was fast enough. */
export type EnginePref = 'auto' | 'gpu' | 'cpu'

type Device = 'webgpu' | 'wasm'

const PREF_KEY = 'lumen-voice-engine'
const AUTO_KEY = 'lumen-voice-auto'
const SINGLE_THREAD_KEY = 'lumen-voice-single-thread'

export function getEnginePref(): EnginePref {
  const v = readPref(PREF_KEY)
  return v === 'gpu' || v === 'cpu' ? v : 'auto'
}

export function setEnginePref(p: EnginePref) {
  writePref(PREF_KEY, p === 'auto' ? null : p)
  if (p === 'auto') writePref(AUTO_KEY, null) // re-test
}

/** What 'auto' found out the first time it tested the GPU. */
export interface AutoResult {
  device: Device
  gpuRtf: number | null
  at: number
}

export function getAutoResult(): AutoResult | null {
  try {
    const v = JSON.parse(readPref(AUTO_KEY) ?? 'null')
    return v && (v.device === 'webgpu' || v.device === 'wasm') ? v : null
  } catch {
    return null
  }
}

export function setAutoResult(r: AutoResult) {
  writePref(AUTO_KEY, JSON.stringify(r))
}

/** Remembered when multi-threaded WASM hung on this device. */
export function singleThreadOnly(): boolean {
  return readPref(SINGLE_THREAD_KEY) === '1'
}
export function setSingleThreadOnly(v: boolean) {
  writePref(SINGLE_THREAD_KEY, v ? '1' : null)
}

/**
 * Decide the first device to try.
 * - pref 'cpu' -> wasm; 'gpu' -> webgpu if available.
 * - 'auto' -> remembered result if any, else webgpu (to be speed-tested) when available.
 * `test` = whether the caller must speed-test the GPU and fall back if it is too slow.
 */
export function chooseDevice(pref: EnginePref, gpuAvailable: boolean, remembered: AutoResult | null): { device: Device; test: boolean } {
  if (!gpuAvailable || pref === 'cpu') return { device: 'wasm', test: false }
  if (pref === 'gpu') return { device: 'webgpu', test: false }
  if (remembered) return { device: remembered.device, test: false }
  return { device: 'webgpu', test: true }
}

export interface Attempt {
  device: Device
  /** WASM thread count to force (1 = single thread); undefined = default */
  threads?: number
  /** reject the GPU if slower than real time */
  speedTest: boolean
}

/** Ordered list of engines to try: each is used only if the previous one stalls (or the GPU is too slow). */
export function attemptChain(pref: EnginePref, gpuAvailable: boolean, remembered: AutoResult | null, singleThread: boolean): Attempt[] {
  const cpu: Attempt[] = singleThread
    ? [{ device: 'wasm', threads: 1, speedTest: false }]
    : [
        { device: 'wasm', speedTest: false },
        { device: 'wasm', threads: 1, speedTest: false },
      ]
  const pick = chooseDevice(pref, gpuAvailable, remembered)
  if (pick.device === 'wasm') return cpu
  if (pref === 'gpu') return [{ device: 'webgpu', speedTest: false }]
  return [{ device: 'webgpu', speedTest: pick.test }, ...cpu]
}
