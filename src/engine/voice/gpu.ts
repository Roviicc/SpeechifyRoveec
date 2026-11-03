let cached: Promise<boolean> | null = null

/** Whether this browser has a WebGPU adapter (asked once per page load). */
export function gpuAvailable(): Promise<boolean> {
  cached ??= (async () => {
    const gpu = (globalThis.navigator as (Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }) | undefined)?.gpu
    if (!gpu) return false
    try {
      return !!(await gpu.requestAdapter())
    } catch {
      return false
    }
  })()
  return cached
}

/** Forget the cached answer (tests). */
export function resetGpuCheck() {
  cached = null
}
