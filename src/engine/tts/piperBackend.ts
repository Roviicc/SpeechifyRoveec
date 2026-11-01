import type { WorkerIn, WorkerOut } from './protocol'
import { CancelledError, type GeneratedAudio, type LoadProgress, type TtsBackend, type TtsInfo } from './types'
import { SILENCE_TIMEOUT_MS } from './engineChoice'

interface Pending {
  resolve: (a: GeneratedAudio) => void
  reject: (e: Error) => void
}

/** Piper (VITS) in a Web Worker: a lighter, much faster voice for phones where Kokoro can't keep up. */
export class PiperBackend implements TtsBackend {
  info: TtsInfo | null = null
  private worker: Worker | null = null
  private initPromise: Promise<TtsInfo> | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1
  private progressByFile = new Map<string, { loaded: number; total: number }>()

  init(onProgress?: (p: LoadProgress) => void): Promise<TtsInfo> {
    this.initPromise ??= this.start(onProgress).catch((e) => {
      this.initPromise = null
      this.worker?.terminate()
      this.worker = null
      throw e
    })
    return this.initPromise
  }

  private start(onProgress?: (p: LoadProgress) => void): Promise<TtsInfo> {
    const worker = new Worker(new URL('./piper.worker.ts', import.meta.url), { type: 'module' })
    this.worker = worker
    return new Promise<TtsInfo>((resolve, reject) => {
      let silence: ReturnType<typeof setTimeout> | undefined
      const arm = () => {
        clearTimeout(silence)
        silence = setTimeout(() => reject(new Error('The voice download or start-up stopped. Check your connection and tap Retry.')), SILENCE_TIMEOUT_MS * 2)
      }
      arm()
      worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
        const m = ev.data
        if (!this.info) arm()
        switch (m.type) {
          case 'progress': {
            if (m.file && m.total) this.progressByFile.set(m.file, { loaded: m.loaded, total: m.total })
            let loaded = 0
            let total = 0
            for (const f of this.progressByFile.values()) {
              loaded += f.loaded
              total += f.total
            }
            onProgress?.({ fraction: total ? loaded / total : null, loadedBytes: loaded, totalBytes: total, status: total && loaded < total ? 'downloading' : 'loading' })
            break
          }
          case 'testing':
            onProgress?.({ fraction: null, loadedBytes: 0, totalBytes: 0, status: 'loading' })
            break
          case 'ready':
            clearTimeout(silence)
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
              clearTimeout(silence)
              reject(new Error(m.message))
            }
        }
      }
      worker.onerror = (e) => reject(new Error(e.message || 'Voice worker failed to start'))
      this.send({ type: 'init', device: 'wasm', dtype: 'q8' })
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

  reset() {
    this.worker?.terminate()
    this.worker = null
    this.initPromise = null
    this.info = null
    this.progressByFile.clear()
    for (const p of this.pending.values()) p.reject(new CancelledError())
    this.pending.clear()
  }
}
