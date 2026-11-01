import type { WorkerIn, WorkerOut } from './protocol'
import { CancelledError, type GeneratedAudio, type LoadProgress, type TtsBackend, type TtsInfo } from './types'
import {
  attemptChain,
  CPU_TEST_TIMEOUT_MS,
  getAutoResult,
  getEnginePref,
  GPU_MAX_RTF,
  GPU_TEST_TIMEOUT_MS,
  setAutoResult,
  setSingleThreadOnly,
  SILENCE_TIMEOUT_MS,
  singleThreadOnly,
  type Attempt,
} from './engineChoice'

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

/** This attempt can't be used (GPU slower than real time, or the engine hung); try the next one. */
class EngineUnusable extends Error {
  constructor(
    readonly reason: 'slow' | 'stuck',
    readonly rtf: number | null = null,
  ) {
    super(reason === 'slow' ? 'too slow' : 'not responding')
  }
}

class DownloadStalled extends Error {
  constructor() {
    super('The voice download stopped. Check your internet connection and tap Retry.')
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
    const pref = getEnginePref()
    const chain = attemptChain(pref, await gpuAvailable(), getAutoResult(), singleThreadOnly())
    let gpuRejected: TtsInfo['gpuRejected']
    for (let k = 0; k < chain.length; k++) {
      const a = chain[k]
      try {
        const info = await this.launch(a, onProgress)
        if (a.device === 'webgpu' && a.speedTest) setAutoResult({ device: 'webgpu', gpuRtf: info.testRtf ?? null, at: Date.now() })
        if (a.device === 'wasm' && a.threads === 1 && k > 0 && chain[k - 1].device === 'wasm') setSingleThreadOnly(true)
        if (gpuRejected) info.gpuRejected = gpuRejected
        return info
      } catch (e) {
        if (!(e instanceof EngineUnusable) || k === chain.length - 1) {
          this.initPromise = null
          if (e instanceof EngineUnusable)
            throw new Error(
              a.device === 'webgpu' ? 'The GPU voice is not responding on this device. Set Settings → Voice engine to Processor.' : 'The voice engine is not responding on this device.',
              { cause: e },
            )
          throw e
        }
        if (a.device === 'webgpu') {
          gpuRejected = { rtf: e.rtf }
          if (pref === 'auto') setAutoResult({ device: 'wasm', gpuRtf: e.rtf, at: Date.now() })
        }
        this.progressByFile.clear()
      }
    }
    throw new Error('No voice engine available')
  }

  /**
   * Start a worker for one attempt. Rejects with EngineUnusable if it stops responding (no message for a long
   * time after the download, or the speed test never finishes) or, with speedTest, if the GPU is slower than real time.
   */
  private launch(a: Attempt, onProgress?: (p: LoadProgress) => void): Promise<TtsInfo> {
    const worker = new Worker(new URL('./kokoro.worker.ts', import.meta.url), { type: 'module' })
    this.worker = worker
    let silence: ReturnType<typeof setTimeout> | undefined
    let testTimer: ReturnType<typeof setTimeout> | undefined
    return new Promise<TtsInfo>((resolve, reject) => {
      let settled = false
      const stop = () => {
        settled = true
        clearTimeout(silence)
        clearTimeout(testTimer)
      }
      const fail = (err: Error) => {
        if (settled) return
        stop()
        worker.terminate()
        if (this.worker === worker) this.worker = null
        reject(err)
      }
      const downloading = () => [...this.progressByFile.values()].some((f) => f.loaded < f.total)
      const armSilence = () => {
        clearTimeout(silence)
        silence = setTimeout(() => fail(downloading() ? new DownloadStalled() : new EngineUnusable('stuck')), SILENCE_TIMEOUT_MS)
      }
      armSilence()
      worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
        const m = ev.data
        if (!settled) armSilence()
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
            clearTimeout(silence)
            testTimer = setTimeout(() => fail(new EngineUnusable('stuck')), a.device === 'webgpu' ? GPU_TEST_TIMEOUT_MS : CPU_TEST_TIMEOUT_MS)
            break
          case 'ready':
            if (settled) return
            if (a.speedTest && (m.info.testRtf ?? 0) > GPU_MAX_RTF) return fail(new EngineUnusable('slow', m.info.testRtf ?? null))
            stop()
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
            } else if (a.device === 'webgpu') {
              // a GPU that fails to run the model counts as unusable
              fail(new EngineUnusable('stuck'))
            } else {
              fail(new Error(m.message))
            }
        }
      }
      worker.onerror = (e) => fail(a.device === 'webgpu' ? new EngineUnusable('stuck') : new Error(e.message || 'Voice worker failed to start'))
      this.send({ type: 'init', device: a.device, dtype: DTYPE[a.device], threads: a.threads ?? requestedThreads() })
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
