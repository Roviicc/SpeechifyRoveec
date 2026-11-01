/// <reference lib="webworker" />
import { TtsSession } from '@mintplex-labs/piper-tts-web'
import { serveVoice, type Samples } from './serveVoice'
import { PIPER_VOICE } from './types'

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

// Same onnxruntime files Kokoro uses (transformers.js serves them from its CDN dist), so one download serves both voices.
const WASM_PATHS = {
  onnxWasm: `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${__TRANSFORMERS_VERSION__}/dist/`,
  piperData: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data',
  piperWasm: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm',
}

/** Read the samples out of the library's WAV output (16-bit or float, wherever its "data" chunk is). */
function decodeWav(buf: ArrayBuffer): Samples {
  const view = new DataView(buf)
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
  if (bits === 32) return { samples: new Float32Array(buf.slice(dataOff, dataOff + dataLen)), sampleRate }
  const samples = new Float32Array(dataLen >> 1)
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(dataOff + i * 2, true) / 0x8000
  return { samples, sampleRate }
}

serveVoice({
  async load(_msg, progress) {
    const tts = await TtsSession.create({
      voiceId: PIPER_VOICE,
      wasmPaths: WASM_PATHS,
      progress: (p) => progress({ file: p.url, loaded: p.loaded, total: p.total, status: 'progress' }),
    })
    return {
      info: { device: 'wasm', dtype: 'piper', isolated: self.crossOriginIsolated, threads, voice: 'piper' },
      synth: async (text) => decodeWav(await (await tts.predict(text)).arrayBuffer()),
    }
  },
})
