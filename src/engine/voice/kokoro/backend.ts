import type { GeneratedAudio, LoadProgress, TtsBackend, TtsInfo } from '@/engine/voice/types'
import { attemptChain, migrateEnginePrefs, setSingleThreadOnly, singleThreadOnly, type Attempt } from '@/engine/voice/choice/engineChoice'
import { CPU_TEST_TIMEOUT_MS, GPU_TEST_TIMEOUT_MS, SILENCE_TIMEOUT_MS } from '@/engine/voice/choice/limits'
import { gpuAvailable } from '@/engine/voice/gpu'
import { WorkerVoiceClient } from '@/engine/voice/shared/workerVoiceClient'
import { GPU_PATCHED_MODEL } from '@/engine/voice/types'

const DTYPE = { webgpu: 'fp32', wasm: 'q8' } as const
type Dtype = 'fp32' | 'q8'

/** `?kdtype=fp32` overrides the processor (WASM) model variant, e.g. to compare sound quality with the GPU. */
function dtypeFor(device: 'webgpu' | 'wasm'): Dtype {
  const want = new URLSearchParams(globalThis.location?.search ?? '').get('kdtype')
  if (device === 'wasm' && (want === 'fp32' || want === 'q8')) return want
  return DTYPE[device]
}

/**
 * On the GPU, use the WebGPU-fixed model (the stock one sounds muffled or broken on some GPUs, e.g. AMD).
 * `?kgpu=stock` loads the original, for comparison.
 */
function modelFor(device: 'webgpu' | 'wasm') {
  const want = new URLSearchParams(globalThis.location?.search ?? '').get('kgpu')
  return device === 'webgpu' && want !== 'stock' ? GPU_PATCHED_MODEL : undefined
}

/** This attempt can't be used (the engine failed to start or hung); try the next one. */
class EngineUnusable extends Error {
  constructor() {
    super('not responding')
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

export interface KokoroOptions {
  /**
   * Run on exactly this device and nothing else (no fallback, nothing remembered). Used for the extra "Turbo"
   * preparing workers, which only exist next to a main voice that already runs on the GPU.
   */
  only?: 'webgpu'
}

/**
 * Kokoro-82M running in a dedicated Web Worker. Tries engines in order (see attemptChain): GPU (WebGPU fp32) when
 * the device has an adapter, then threaded CPU, then single-thread CPU (WASM q8), moving on when one fails or stalls.
 */
export class KokoroBackend implements TtsBackend {
  private client = new WorkerVoiceClient()
  private initPromise: Promise<TtsInfo> | null = null

  constructor(private readonly opts: KokoroOptions = {}) {}

  get info(): TtsInfo | null {
    return this.client.info
  }

  init(onProgress?: (p: LoadProgress) => void): Promise<TtsInfo> {
    this.initPromise ??= this.start(onProgress)
    return this.initPromise
  }

  private async start(onProgress?: (p: LoadProgress) => void): Promise<TtsInfo> {
    if (this.opts.only) {
      try {
        return await this.launch({ device: this.opts.only }, onProgress)
      } catch (e) {
        this.initPromise = null
        throw e instanceof EngineUnusable ? new Error('The GPU could not start another voice worker.', { cause: e }) : e
      }
    }
    migrateEnginePrefs()
    const chain = attemptChain(await gpuAvailable(), singleThreadOnly())
    let gpuFailed = false
    for (let k = 0; k < chain.length; k++) {
      const a = chain[k]
      try {
        const info = await this.launch(a, onProgress)
        // threaded CPU hung but single-thread worked: skip the threaded attempt next time
        if (a.device === 'wasm' && a.threads === 1 && k > 0 && chain[k - 1].device === 'wasm') setSingleThreadOnly(true)
        if (gpuFailed) info.gpuFailed = true
        return info
      } catch (e) {
        if (!(e instanceof EngineUnusable) || k === chain.length - 1) {
          this.initPromise = null
          if (e instanceof EngineUnusable) throw new Error('The voice engine is not responding on this device.', { cause: e })
          throw e
        }
        // the GPU failed or stalled: fall back to the processor without bothering the user
        if (a.device === 'webgpu') gpuFailed = true
        this.client.clearProgress()
      }
    }
    throw new Error('No voice engine available')
  }

  /**
   * Start a worker for one attempt. Rejects with EngineUnusable if it stops responding (no message for a long
   * time after the download, or the start-up test never finishes). A GPU that fails to run the model at all
   * (no adapter, out of memory, driver error) also counts as unusable.
   */
  private launch(a: Attempt, onProgress?: (p: LoadProgress) => void): Promise<TtsInfo> {
    const gpu = a.device === 'webgpu'
    return this.client.launch(
      () => new Worker(new URL('./kokoro.worker.ts', import.meta.url), { type: 'module' }),
      {
        init: { type: 'init', device: a.device, dtype: dtypeFor(a.device), threads: a.threads ?? requestedThreads(), model: modelFor(a.device) },
        silenceMs: SILENCE_TIMEOUT_MS,
        silenceError: (downloading) => (downloading ? new DownloadStalled() : new EngineUnusable()),
        testTimeoutMs: gpu ? GPU_TEST_TIMEOUT_MS : CPU_TEST_TIMEOUT_MS,
        testTimeoutError: () => new EngineUnusable(),
        startError: (message) => (gpu ? new EngineUnusable() : new Error(message)),
        crashError: (e) => (gpu ? new EngineUnusable() : new Error(e.message || 'Voice worker failed to start')),
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
