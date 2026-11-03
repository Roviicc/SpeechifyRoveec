export type TtsDevice = 'webgpu' | 'wasm' | 'fake'

export interface TtsInfo {
  device: TtsDevice
  dtype: string
  /** whether the worker runs cross-origin isolated (needed for WASM threads) */
  isolated?: boolean
  /** onnxruntime-web WASM threads (1 = single-threaded; irrelevant on WebGPU) */
  threads?: number
  /** real-time factor of the start-up speed test (generation time / audio length) */
  testRtf?: number
  /** set when the GPU was tried but failed or stalled, so the voice fell back to the processor */
  gpuFailed?: boolean
  voice?: VoiceModel
  /** Auto mode chose Piper because Kokoro's speed test was too slow (null = Kokoro failed to start) */
  autoSwitched?: { kokoroRtf: number | null }
}

export interface LoadProgress {
  /** 0..1 overall download progress, or null when unknown */
  fraction: number | null
  loadedBytes: number
  totalBytes: number
  status: 'downloading' | 'loading' | 'ready'
}

export interface GeneratedAudio {
  /** 16-bit PCM WAV */
  wav: Blob
  duration: number
  /** milliseconds spent generating (for real-time-factor stats) */
  genMs: number
}

/** Anything that can turn text into speech: Kokoro in a worker, a fake for tests, later a native engine. */
export interface TtsBackend {
  readonly info: TtsInfo | null
  init(onProgress?: (p: LoadProgress) => void): Promise<TtsInfo>
  /** Requests carry an epoch; cancel(epoch) drops queued requests from older epochs. */
  generate(text: string, epoch: number): Promise<GeneratedAudio>
  cancel(epoch: number): void
  /** Drop the loaded model so the next init() starts again (e.g. after changing the engine). */
  reset?(): void
}

export class CancelledError extends Error {
  constructor() {
    super('cancelled')
    this.name = 'CancelledError'
  }
}

export const VOICE = 'af_heart'
/** Piper voice used by the fast engine (US English, female, medium quality ~63 MB). */
export const PIPER_VOICE = 'en_US-lessac-medium'

export type VoiceModel = 'kokoro' | 'piper'
export const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'
/**
 * The same Kokoro model with the vocoder's ConvTranspose layers rewritten as zero-insertion + Conv, which
 * onnxruntime-web's WebGPU backend computes correctly (its ConvTranspose gives wrong/muffled audio on AMD GPUs).
 * Pinned to a commit so the file can't change under us. See docs/DECISIONS.md.
 */
export const GPU_PATCHED_MODEL = { id: 'DevAmarnadhCG/Kokoro-82M-v1.0-ONNX-webgpu', revision: '7d1a298d7e12fbfdd1e24a1d35f6c5181a0ad41a' }
