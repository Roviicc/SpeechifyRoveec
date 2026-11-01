import type { WorkerIn, WorkerOut } from './protocol'
import { CancelledError, type GeneratedAudio, type LoadProgress, type TtsBackend, type TtsInfo } from './types'

interface Pending {
  resolve: (a: GeneratedAudio) => void
  reject: (e: Error) => void
}

async function pickDevice(): Promise<{ device: 'webgpu' | 'wasm'; dtype: 'fp32' | 'q8' }> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  if (gpu) {
    try {
      if (await gpu.requestAdapter()) return { device: 'webgpu', dtype: 'fp32' }
    } catch {
      /* fall through */
    }
  }
  return { device: 'wasm', dtype: 'q8' }
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
    const choice = await pickDevice()
    const worker = new Worker(new URL('./kokoro.worker.ts', import.meta.url), { type: 'module' })
    this.worker = worker
    return new Promise<TtsInfo>((resolve, reject) => {
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
          case 'ready':
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
            } else {
              this.initPromise = null
              reject(new Error(m.message))
            }
        }
      }
      worker.onerror = (e) => reject(new Error(e.message || 'Voice worker failed to start'))
      this.send({ type: 'init', ...choice })
    })
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
