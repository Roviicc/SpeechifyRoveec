export type TtsDevice = 'webgpu' | 'wasm' | 'fake'

export interface TtsInfo {
  device: TtsDevice
  dtype: string
  /** whether the worker runs cross-origin isolated (needed for WASM threads) */
  isolated?: boolean
  /** onnxruntime-web WASM threads (1 = single-threaded; irrelevant on WebGPU) */
  threads?: number
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
}

export class CancelledError extends Error {
  constructor() {
    super('cancelled')
    this.name = 'CancelledError'
  }
}

export const VOICE = 'af_heart'
export const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'
