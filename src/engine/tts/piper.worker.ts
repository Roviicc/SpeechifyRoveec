/// <reference lib="webworker" />
import { TtsSession } from '@mintplex-labs/piper-tts-web'
import { encodeWav, trimSilence } from './wav'
import { PIPER_VOICE } from './types'
import type { WorkerIn, WorkerOut } from './protocol'

declare const self: DedicatedWorkerGlobalScope

// The library sets onnxruntime's WASM thread count to navigator.hardwareConcurrency; cap it so the UI and
// audio keep a core (and threads only work at all when the page is cross-origin isolated).
const cores = navigator.hardwareConcurrency || 2
const threads = self.crossOriginIsolated ? Math.max(1, Math.min(4, cores - 1)) : 1
try {
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => threads })
} catch {
  /* read-only in this browser: the library will use all cores */
}

// onnxruntime-web runtime files must match the installed onnxruntime-web version.
const ORT_VERSION = '1.22.0-dev.20250409-89f8206ba4'
const WASM_PATHS = {
  onnxWasm: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`,
  piperData: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data',
  piperWasm: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm',
}

let tts: TtsSession | null = null
let minEpoch = 0
const queue: Array<{ reqId: number; epoch: number; text: string }> = []
let busy = false

const post = (msg: WorkerOut, transfer: Transferable[] = []) => self.postMessage(msg, transfer)

/** Generate one sentence and return 16-bit WAV + duration (silence-trimmed like Kokoro). */
async function speak(text: string): Promise<{ wav: ArrayBuffer; duration: number }> {
  const blob = await tts!.predict(text)
  const buf = await blob.arrayBuffer()
  const view = new DataView(buf)
  // locate the "data" chunk of the library's WAV and read 16-bit or float samples
  const sampleRate = view.getUint32(24, true)
  const bits = view.getUint16(34, true)
  let off = 12
  let dataOff = 44
  let dataLen = buf.byteLength - 44
  while (off + 8 <= buf.byteLength) {
    const id = String.fromCharCode(view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3))
    const size = view.getUint32(off + 4, true)
    if (id === 'data') {
      dataOff = off + 8
      dataLen = Math.min(size, buf.byteLength - dataOff)
      break
    }
    off += 8 + size + (size % 2)
  }
  let samples: Float32Array
  if (bits === 32) samples = new Float32Array(buf.slice(dataOff, dataOff + dataLen))
  else {
    const n = dataLen >> 1
    samples = new Float32Array(n)
    for (let i = 0; i < n; i++) samples[i] = view.getInt16(dataOff + i * 2, true) / 0x8000
  }
  const trimmed = trimSilence(samples, sampleRate)
  return { wav: encodeWav(trimmed, sampleRate), duration: trimmed.length / sampleRate }
}

async function pump() {
  if (busy || !tts) return
  busy = true
  try {
    while (queue.length) {
      const job = queue.shift()!
      if (job.epoch < minEpoch) {
        post({ type: 'cancelled', reqId: job.reqId })
        continue
      }
      try {
        const t0 = performance.now()
        const { wav, duration } = await speak(job.text)
        post({ type: 'audio', reqId: job.reqId, epoch: job.epoch, wav, duration, genMs: performance.now() - t0 }, [wav])
      } catch (e) {
        post({ type: 'error', reqId: job.reqId, message: String((e as Error)?.message ?? e) })
      }
    }
  } finally {
    busy = false
  }
}

self.onmessage = async (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data
  if (msg.type === 'init') {
    try {
      tts = await TtsSession.create({
        voiceId: PIPER_VOICE,
        wasmPaths: WASM_PATHS,
        progress: (p) => post({ type: 'progress', file: p.url, loaded: p.loaded, total: p.total, status: 'progress' }),
      })
      post({ type: 'testing' })
      await speak('Hello.')
      const t0 = performance.now()
      const test = await speak('This is a short test of the reading voice.')
      const testRtf = (performance.now() - t0) / 1000 / test.duration
      post({ type: 'ready', info: { device: 'wasm', dtype: 'piper', isolated: self.crossOriginIsolated, threads, testRtf, voice: 'piper' } })
      void pump()
    } catch (e) {
      post({ type: 'error', message: String((e as Error)?.message ?? e) })
    }
  } else if (msg.type === 'generate') {
    queue.push(msg)
    void pump()
  } else if (msg.type === 'cancel') {
    minEpoch = Math.max(minEpoch, msg.epoch)
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].epoch < minEpoch) {
        post({ type: 'cancelled', reqId: queue[i].reqId })
        queue.splice(i, 1)
      }
    }
  }
}
