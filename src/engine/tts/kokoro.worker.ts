/// <reference lib="webworker" />
import { KokoroTTS } from 'kokoro-js'
import { encodeWav, trimSilence } from './wav'
import { MODEL_ID, VOICE } from './types'
import type { WorkerIn, WorkerOut } from './protocol'

declare const self: DedicatedWorkerGlobalScope

let tts: KokoroTTS | null = null
let minEpoch = 0
const queue: Array<{ reqId: number; epoch: number; text: string }> = []
let busy = false

const post = (msg: WorkerOut, transfer: Transferable[] = []) => self.postMessage(msg, transfer)

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
        const audio = await tts.generate(job.text, { voice: VOICE })
        const genMs = performance.now() - t0
        const samples = trimSilence(audio.audio, audio.sampling_rate)
        const wav = encodeWav(samples, audio.sampling_rate)
        post(
          { type: 'audio', reqId: job.reqId, epoch: job.epoch, wav, duration: samples.length / audio.sampling_rate, genMs },
          [wav],
        )
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
      tts = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: msg.dtype,
        device: msg.device,
        progress_callback: (p) => {
          const info = p as { status: string; file?: string; loaded?: number; total?: number }
          if (info.status === 'progress' || info.status === 'done' || info.status === 'initiate') {
            post({ type: 'progress', file: info.file ?? '', loaded: info.loaded ?? 0, total: info.total ?? 0, status: info.status })
          }
        },
      })
      // warm-up so the first real sentence is fast (also downloads the voice file)
      await tts.generate('Hello.', { voice: VOICE })
      post({ type: 'ready', info: { device: msg.device, dtype: msg.dtype } })
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
