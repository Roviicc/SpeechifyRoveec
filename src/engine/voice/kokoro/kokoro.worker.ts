/// <reference lib="webworker" />
import { KokoroTTS } from 'kokoro-js'
import { env } from '@huggingface/transformers'
import { serveVoice } from '@/engine/voice/shared/serveVoice'
import { MODEL_ID, VOICE } from '@/engine/voice/types'

declare const self: DedicatedWorkerGlobalScope

/**
 * onnxruntime-web can only use WASM threads when SharedArrayBuffer is available, i.e. when the page is
 * cross-origin isolated (COOP + COEP headers, see vercel.json / vite.config.ts). Otherwise it is 1 thread.
 * Default: up to 4 threads, leaving one core for the UI and audio. Returns the thread count in use.
 */
function configureWasmThreads(requested?: number): number {
  const wasm = env.backends.onnx.wasm as { numThreads?: number; proxy?: boolean } | undefined
  const canThread = self.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined'
  const cores = navigator.hardwareConcurrency || 2
  const threads = canThread ? Math.max(1, Math.min(requested ?? Math.min(4, cores - 1), cores)) : 1
  if (wasm) {
    wasm.numThreads = threads
    wasm.proxy = false // we already are in a worker
  }
  return threads
}

serveVoice({
  async load(msg, progress) {
    const threads = configureWasmThreads(msg.threads)
    // kokoro-js doesn't pass a revision through, so pin it via the download path (this worker loads one model)
    if (msg.model) env.remotePathTemplate = `{model}/resolve/${msg.model.revision}/`
    const tts = await KokoroTTS.from_pretrained(msg.model?.id ?? MODEL_ID, {
      dtype: msg.dtype,
      device: msg.device,
      progress_callback: (p) => {
        const info = p as { status: string; file?: string; loaded?: number; total?: number }
        if (info.status === 'progress' || info.status === 'done' || info.status === 'initiate') {
          progress({ file: info.file ?? '', loaded: info.loaded ?? 0, total: info.total ?? 0, status: info.status })
        }
      },
    })
    return {
      info: { device: msg.device, dtype: msg.dtype, isolated: self.crossOriginIsolated, threads },
      async synth(text) {
        const audio = await tts.generate(text, { voice: VOICE })
        return { samples: audio.audio, sampleRate: audio.sampling_rate }
      },
    }
  },
})
