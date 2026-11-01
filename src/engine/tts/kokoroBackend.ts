import type { WorkerIn, WorkerOut } from './protocol'
import { CancelledError, type GeneratedAudio, type LoadProgress, type TtsBackend, type TtsInfo } from './types'
import { chooseDevice, getAutoResult, getEnginePref, GPU_MAX_RTF, GPU_TEST_TIMEOUT_MS, setAutoResult } from './engineChoice'

interface Pending {
  resolve: (a: GeneratedAudio) => void
  reject: (e: Error) => void
}

async function gpuAvailable(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  if (!gpu) return false
  try {
    return !!(await gpu.requestAdapter())
  } catch {
    return false
  }
}

const DTYPE = { webgpu: 'fp32', wasm: 'q8' } as const

class GpuTooSlow extends Error {
  constructor(readonly rtf: number | null) {
    super('GPU too slow')
  }
}

/** `?threads=N` overrides the WASM thread count (for benchmarking); only effective when cross-origin isolated. */
function requestedThreads(): number | undefined {
  const n = Number(new URLSearchParams(globalThis.location?.search ?? '').get('threads'))
  return Number.isInteger(n) && n > 0 ? n : undefined
}

/** Kokoro-82M running in a dedicated Web Worker (WebGPU fp32, or WASM q8 fallback). */
export class KokoroBackend implements TtsBackend {
  info: TtsInfo | null = null
  private worker: Worker | null = null
  private initPromise: Promise<TtsInfo> | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1
  private progressByFile = new Map<string, { loaded: number; total: number }>()

  init(onProgress?: (p: LoadProgress) => void): Promise<TtsInfo> {
    this.initPromise ??= this.start(onProgress)
    return this.initPromise
  }

  private async start(onProgress?: (p: LoadProgress) => void): Promise<TtsInfo> {
    const pick = chooseDevice(getEnginePref(), await gpuAvailable(), getAutoResult())
    if (!pick.test) return this.launch(pick.device, false, onProgress)
    try {
      const info = await this.launch('webgpu', true, onProgress)
      setAutoResult({ device: 'webgpu', gpuRtf: info.testRtf ?? null, at: Date.now() })
      return info
    } catch (e) {
      if (!(e instanceof GpuTooSlow)) throw e
      // The GPU is slower than real time on this device (or hangs): use the processor instead, and remember it.
      setAutoResult({ device: 'wasm', gpuRtf: e.rtf, at: Date.now() })
      this.progressByFile.clear()
      const info = await this.launch('wasm', false, onProgress)
      info.gpuRejected = { rtf: e.rtf }
      return info
    }
  }

  /** Start a worker on `device`. With `test`, reject with GpuTooSlow if its speed test is too slow or times out. */
  private launch(device: 'webgpu' | 'wasm', test: boolean, onProgress?: (p: LoadProgress) => void): Promise<TtsInfo> {
    const worker = new Worker(new URL('./kokoro.worker.ts', import.meta.url), { type: 'module' })
    this.worker = worker
    let watchdog: ReturnType<typeof setTimeout> | undefined
    return new Promise<TtsInfo>((resolve, reject) => {
      const giveUp = (rtf: number | null) => {
        clearTimeout(watchdog)
        worker.terminate()
        if (this.worker === worker) this.worker = null
        reject(new GpuTooSlow(rtf))
      }
      worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
        const m = ev.data
        switch (m.type) {
          case 'progress': {
            if (m.file && m.total) this.progressByFile.set(m.file, { loaded: m.loaded, total: m.total })
            let loaded = 0
            let total = 0
            for (const f of this.progressByFile.values()) {
              loaded += f.loaded
              total += f.total
            }
            onProgress?.({ fraction: total ? loaded / total : null, loadedBytes: loaded, totalBytes: total, status: loaded >= total ? 'loading' : 'downloading' })
            break
          }
          case 'testing':
            onProgress?.({ fraction: null, loadedBytes: 0, totalBytes: 0, status: 'loading' })
            if (test) watchdog = setTimeout(() => giveUp(null), GPU_TEST_TIMEOUT_MS)
            break
          case 'ready':
            clearTimeout(watchdog)
            if (test && (m.info.testRtf ?? 0) > GPU_MAX_RTF) return giveUp(m.info.testRtf ?? null)
            this.info = m.info
            onProgress?.({ fraction: 1, loadedBytes: 0, totalBytes: 0, status: 'ready' })
            resolve(m.info)
            break
          case 'audio': {
            const p = this.pending.get(m.reqId)
            this.pending.delete(m.reqId)
            p?.resolve({ wav: new Blob([m.wav], { type: 'audio/wav' }), duration: m.duration, genMs: m.genMs })
            break
          }
          case 'cancelled': {
            const p = this.pending.get(m.reqId)
            this.pending.delete(m.reqId)
            p?.reject(new CancelledError())
            break
          }
          case 'error':
            if (m.reqId !== undefined) {
              const p = this.pending.get(m.reqId)
              this.pending.delete(m.reqId)
              p?.reject(new Error(m.message))
            } else if (test) {
              // a GPU that fails to run the model counts as unusable
              giveUp(null)
            } else {
              this.initPromise = null
              reject(new Error(m.message))
            }
        }
      }
      worker.onerror = (e) => (test ? giveUp(null) : reject(new Error(e.message || 'Voice worker failed to start')))
      this.send({ type: 'init', device, dtype: DTYPE[device], threads: requestedThreads() })
    })
  }

  reset() {
    this.worker?.terminate()
    this.worker = null
    this.initPromise = null
    this.info = null
    this.progressByFile.clear()
    for (const p of this.pending.values()) p.reject(new CancelledError())
    this.pending.clear()
  }

  private send(msg: WorkerIn) {
    this.worker?.postMessage(msg)
  }

  async generate(text: string, epoch: number): Promise<GeneratedAudio> {
    await this.init()
    const reqId = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject })
      this.send({ type: 'generate', reqId, epoch, text })
    })
  }

  cancel(epoch: number): void {
    this.send({ type: 'cancel', epoch })
  }
}
