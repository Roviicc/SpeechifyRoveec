/** Which hardware runs the voice. 'auto' tests the GPU once and remembers whether it was fast enough. */
export type EnginePref = 'auto' | 'gpu' | 'cpu'

const PREF_KEY = 'lumen-voice-engine'
const AUTO_KEY = 'lumen-voice-auto'

/** GPU must generate at least this fast (RTF = generation time / audio time) or 'auto' falls back to the CPU. */
export const GPU_MAX_RTF = 1
/** If the GPU hasn't finished its speed test after this long, it is treated as too slow. */
export const GPU_TEST_TIMEOUT_MS = 30_000

function get(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function set(key: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(key)
    else localStorage.setItem(key, v)
  } catch {
    /* private mode */
  }
}

export function getEnginePref(): EnginePref {
  const v = get(PREF_KEY)
  return v === 'gpu' || v === 'cpu' ? v : 'auto'
}

export function setEnginePref(p: EnginePref) {
  set(PREF_KEY, p === 'auto' ? null : p)
  if (p === 'auto') set(AUTO_KEY, null) // re-test
}

export interface AutoResult {
  device: 'webgpu' | 'wasm'
  gpuRtf: number | null
  at: number
}

export function getAutoResult(): AutoResult | null {
  try {
    const v = JSON.parse(get(AUTO_KEY) ?? 'null')
    return v && (v.device === 'webgpu' || v.device === 'wasm') ? v : null
  } catch {
    return null
  }
}

export function setAutoResult(r: AutoResult) {
  set(AUTO_KEY, JSON.stringify(r))
}

/**
 * Decide the first device to try.
 * - pref 'cpu' -> wasm; 'gpu' -> webgpu if available.
 * - 'auto' -> remembered result if any, else webgpu (to be speed-tested) when available.
 * `test` = whether the caller must speed-test the GPU and fall back if it is too slow.
 */
export function chooseDevice(pref: EnginePref, gpuAvailable: boolean, remembered: AutoResult | null): { device: 'webgpu' | 'wasm'; test: boolean } {
  if (!gpuAvailable || pref === 'cpu') return { device: 'wasm', test: false }
  if (pref === 'gpu') return { device: 'webgpu', test: false }
  if (remembered) return { device: remembered.device, test: false }
  return { device: 'webgpu', test: true }
}

/** No message at all from the worker for this long (download or load stalled) -> give up on this attempt. */
export const SILENCE_TIMEOUT_MS = 90_000
/** Processor speed test must finish within this (generous: slow phones run at RTF ~3). */
export const CPU_TEST_TIMEOUT_MS = 75_000

const SINGLE_THREAD_KEY = 'lumen-voice-single-thread'
/** Remembered when multi-threaded WASM hung on this device. */
export function singleThreadOnly(): boolean {
  return get(SINGLE_THREAD_KEY) === '1'
}
export function setSingleThreadOnly(v: boolean) {
  set(SINGLE_THREAD_KEY, v ? '1' : null)
}

export interface Attempt {
  device: 'webgpu' | 'wasm'
  /** WASM thread count to force (1 = single thread); undefined = default */
  threads?: number
  /** reject the GPU if slower than real time */
  speedTest: boolean
}

/** Ordered list of engines to try: each is used only if the previous one stalls (or the GPU is too slow). */
export function attemptChain(pref: EnginePref, gpuAvailable: boolean, remembered: AutoResult | null, singleThread: boolean): Attempt[] {
  const cpu: Attempt[] = singleThread ? [{ device: 'wasm', threads: 1, speedTest: false }] : [{ device: 'wasm', speedTest: false }, { device: 'wasm', threads: 1, speedTest: false }]
  const pick = chooseDevice(pref, gpuAvailable, remembered)
  if (pick.device === 'wasm') return cpu
  if (pref === 'gpu') return [{ device: 'webgpu', speedTest: false }]
  return [{ device: 'webgpu', speedTest: pick.test }, ...cpu]
}
