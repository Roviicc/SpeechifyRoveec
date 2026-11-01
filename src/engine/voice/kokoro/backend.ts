import type { GeneratedAudio, LoadProgress, TtsBackend, TtsInfo } from '@/engine/voice/types'
import { attemptChain, getAutoResult, getEnginePref, setAutoResult, setSingleThreadOnly, singleThreadOnly, type Attempt } from '@/engine/voice/choice/engineChoice'
import { CPU_TEST_TIMEOUT_MS, GPU_MAX_RTF, GPU_TEST_TIMEOUT_MS, SILENCE_TIMEOUT_MS } from '@/engine/voice/choice/limits'
import { WorkerVoiceClient } from '@/engine/voice/shared/workerVoiceClient'

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

/**
 * Kokoro-82M running in a dedicated Web Worker. Tries engines in order (see attemptChain): GPU (WebGPU fp32,
 * speed-tested in 'auto'), then threaded CPU, then single-thread CPU (WASM q8), moving on when one stalls.
 */
export class KokoroBackend implements TtsBackend {
  private client = new WorkerVoiceClient()
  private initPromise: Promise<TtsInfo> | null = null

  get info(): TtsInfo | null {
    return this.client.info
  }

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
        // threaded CPU hung but single-thread worked: skip the threaded attempt next time
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
        this.client.clearProgress()
      }
    }
    throw new Error('No voice engine available')
  }

  /**
   * Start a worker for one attempt. Rejects with EngineUnusable if it stops responding (no message for a long
   * time after the download, or the speed test never finishes) or, with speedTest, if the GPU is slower than real time.
   * A GPU that fails to run the model at all also counts as unusable.
   */
  private launch(a: Attempt, onProgress?: (p: LoadProgress) => void): Promise<TtsInfo> {
    const gpu = a.device === 'webgpu'
    return this.client.launch(
      () => new Worker(new URL('./kokoro.worker.ts', import.meta.url), { type: 'module' }),
      {
        init: { type: 'init', device: a.device, dtype: DTYPE[a.device], threads: a.threads ?? requestedThreads() },
        silenceMs: SILENCE_TIMEOUT_MS,
        silenceError: (downloading) => (downloading ? new DownloadStalled() : new EngineUnusable('stuck')),
        testTimeoutMs: gpu ? GPU_TEST_TIMEOUT_MS : CPU_TEST_TIMEOUT_MS,
        testTimeoutError: () => new EngineUnusable('stuck'),
        startError: (message) => (gpu ? new EngineUnusable('stuck') : new Error(message)),
        crashError: (e) => (gpu ? new EngineUnusable('stuck') : new Error(e.message || 'Voice worker failed to start')),
        rejectReady: (info) => (a.speedTest && (info.testRtf ?? 0) > GPU_MAX_RTF ? new EngineUnusable('slow', info.testRtf ?? null) : null),
      },
      onProgress,
    )
  }

  async generate(text: string, epoch: number): Promise<GeneratedAudio> {
    await this.init()
    return this.client.generate(text, epoch)
  }

  cancel(epoch: number): void {
    this.client.cancel(epoch)
  }

  reset() {
    this.client.reset()
    this.initPromise = null
  }
}
