import type { WorkerIn, WorkerOut } from './protocol'
import { CancelledError, type GeneratedAudio, type LoadProgress, type TtsInfo } from './types'

/** How one worker start-up is supervised; each voice decides which error each failure becomes. */
export interface LaunchOptions {
  init: Extract<WorkerIn, { type: 'init' }>
  /** Give up when the worker sends nothing for this long during start-up. */
  silenceMs: number
  /** Error for a silent worker; `downloading` = some model file was still incomplete. */
  silenceError(downloading: boolean): Error
  /** The speed test after 'testing' must finish within this. */
  testTimeoutMs: number
  testTimeoutError(): Error
  /** Error for a start-up failure reported by the worker (an 'error' without reqId). */
  startError(message: string): Error
  /** Error for the worker script failing to load or crashing. */
  crashError(event: ErrorEvent): Error
  /** Optional check of the 'ready' info: return an error to reject this start-up (e.g. too slow). */
  rejectReady?(info: TtsInfo): Error | null
}

interface Pending {
  resolve: (a: GeneratedAudio) => void
  reject: (e: Error) => void
}

/**
 * Main-thread side of a voice worker (protocol.ts): starts it with watchdogs, aggregates download progress across
 * model files, and matches generate requests to their audio. A failed start-up terminates the worker.
 */
export class WorkerVoiceClient {
  info: TtsInfo | null = null
  private worker: Worker | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1
  private progressByFile = new Map<string, { loaded: number; total: number }>()

  launch(createWorker: () => Worker, o: LaunchOptions, onProgress?: (p: LoadProgress) => void): Promise<TtsInfo> {
    const worker = createWorker()
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
      const armSilence = () => {
        clearTimeout(silence)
        silence = setTimeout(() => fail(o.silenceError(this.downloading())), o.silenceMs)
      }
      armSilence()
      worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
        const m = ev.data
        if (!settled) armSilence()
        switch (m.type) {
          case 'progress':
            if (m.file && m.total) this.progressByFile.set(m.file, { loaded: m.loaded, total: m.total })
            onProgress?.(this.totalProgress())
            break
          case 'testing':
            onProgress?.({ fraction: null, loadedBytes: 0, totalBytes: 0, status: 'loading' })
            clearTimeout(silence)
            testTimer = setTimeout(() => fail(o.testTimeoutError()), o.testTimeoutMs)
            break
          case 'ready': {
            if (settled) return
            const rejected = o.rejectReady?.(m.info)
            if (rejected) return fail(rejected)
            stop()
            this.info = m.info
            onProgress?.({ fraction: 1, loadedBytes: 0, totalBytes: 0, status: 'ready' })
            resolve(m.info)
            break
          }
          case 'audio':
            this.take(m.reqId)?.resolve({ wav: new Blob([m.wav], { type: 'audio/wav' }), duration: m.duration, genMs: m.genMs })
            break
          case 'cancelled':
            this.take(m.reqId)?.reject(new CancelledError())
            break
          case 'error':
            if (m.reqId !== undefined) this.take(m.reqId)?.reject(new Error(m.message))
            else fail(o.startError(m.message))
        }
      }
      worker.onerror = (e) => fail(o.crashError(e))
      this.send(o.init)
    })
  }

  generate(text: string, epoch: number): Promise<GeneratedAudio> {
    const reqId = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject })
      this.send({ type: 'generate', reqId, epoch, text })
    })
  }

  cancel(epoch: number) {
    this.send({ type: 'cancel', epoch })
  }

  /** Forget download progress (before starting another attempt). */
  clearProgress() {
    this.progressByFile.clear()
  }

  /** Stop the worker and fail every request still waiting. */
  reset() {
    this.worker?.terminate()
    this.worker = null
    this.info = null
    this.progressByFile.clear()
    for (const p of this.pending.values()) p.reject(new CancelledError())
    this.pending.clear()
  }

  private send(msg: WorkerIn) {
    this.worker?.postMessage(msg)
  }

  private take(reqId: number): Pending | undefined {
    const p = this.pending.get(reqId)
    this.pending.delete(reqId)
    return p
  }

  private downloading(): boolean {
    return [...this.progressByFile.values()].some((f) => f.loaded < f.total)
  }

  private totalProgress(): LoadProgress {
    let loaded = 0
    let total = 0
    for (const f of this.progressByFile.values()) {
      loaded += f.loaded
      total += f.total
    }
    return { fraction: total ? loaded / total : null, loadedBytes: loaded, totalBytes: total, status: loaded >= total ? 'loading' : 'downloading' }
  }
}
