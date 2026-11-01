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
