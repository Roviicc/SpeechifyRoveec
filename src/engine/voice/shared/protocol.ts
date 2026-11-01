import type { TtsInfo } from '@/engine/voice/types'

export type WorkerIn =
  | { type: 'init'; device: 'webgpu' | 'wasm'; dtype: 'fp32' | 'q8'; threads?: number }
  | { type: 'generate'; reqId: number; epoch: number; text: string }
  | { type: 'cancel'; epoch: number }

export type WorkerOut =
  | { type: 'progress'; file: string; loaded: number; total: number; status: string }
  | { type: 'testing' }
  | { type: 'ready'; info: TtsInfo }
  | { type: 'audio'; reqId: number; epoch: number; wav: ArrayBuffer; duration: number; genMs: number }
  | { type: 'cancelled'; reqId: number }
  | { type: 'error'; reqId?: number; message: string }
