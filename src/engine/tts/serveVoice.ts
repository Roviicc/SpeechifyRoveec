/// <reference lib="webworker" />
import { encodeWav, trimSilence } from './wav'
import type { WorkerIn, WorkerOut } from './protocol'
import type { TtsInfo } from './types'

/**
 * Worker side of every voice: the job queue, epoch cancelling and the message protocol (protocol.ts).
 * A voice worker only loads its model and turns text into samples; see kokoro.worker.ts / piper.worker.ts.
 */

declare const self: DedicatedWorkerGlobalScope

export type InitMsg = Extract<WorkerIn, { type: 'init' }>

/** Raw synthesised speech, before silence trimming. */
export interface Samples {
  samples: Float32Array
  sampleRate: number
}

export interface LoadedVoice {
  /** what to report in 'ready' (testRtf is added here) */
  info: Omit<TtsInfo, 'testRtf'>
  synth(text: string): Promise<Samples>
}

export interface VoiceDefinition {
  /** Download and load the model; report download progress per file. */
  load(msg: InitMsg, progress: (p: Omit<Extract<WorkerOut, { type: 'progress' }>, 'type'>) => void): Promise<LoadedVoice>
}

const post = (msg: WorkerOut, transfer: Transferable[] = []) => self.postMessage(msg, transfer)
const message = (e: unknown) => String((e as Error)?.message ?? e)

export function serveVoice(def: VoiceDefinition) {
  let voice: LoadedVoice | null = null
  let minEpoch = 0
  let busy = false
  const queue: Array<{ reqId: number; epoch: number; text: string }> = []

  async function pump() {
    if (busy || !voice) return
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
          const { samples, sampleRate } = await voice.synth(job.text)
          const genMs = performance.now() - t0
          const trimmed = trimSilence(samples, sampleRate)
          const wav = encodeWav(trimmed, sampleRate)
          post({ type: 'audio', reqId: job.reqId, epoch: job.epoch, wav, duration: trimmed.length / sampleRate, genMs }, [wav])
        } catch (e) {
          post({ type: 'error', reqId: job.reqId, message: message(e) })
        }
      }
    } finally {
      busy = false
    }
  }

  async function init(msg: InitMsg) {
    try {
      const loaded = await def.load(msg, (p) => post({ type: 'progress', ...p }))
      // Model loaded. Warm up (downloads the voice, compiles GPU shaders), then time a test sentence so the
      // main thread can reject an engine that is too slow. 'testing' starts its watchdog.
      post({ type: 'testing' })
      await loaded.synth('Hello.')
      const t0 = performance.now()
      const test = await loaded.synth('This is a short test of the reading voice.')
      const testRtf = (performance.now() - t0) / 1000 / (test.samples.length / test.sampleRate)
      voice = loaded
      post({ type: 'ready', info: { ...loaded.info, testRtf } })
      void pump()
    } catch (e) {
      post({ type: 'error', message: message(e) })
    }
  }

  function cancel(epoch: number) {
    minEpoch = Math.max(minEpoch, epoch)
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].epoch < minEpoch) {
        post({ type: 'cancelled', reqId: queue[i].reqId })
        queue.splice(i, 1)
      }
    }
  }

  self.onmessage = (ev: MessageEvent<WorkerIn>) => {
    const msg = ev.data
    if (msg.type === 'init') void init(msg)
    else if (msg.type === 'generate') {
      queue.push(msg)
      void pump()
    } else if (msg.type === 'cancel') cancel(msg.epoch)
  }
}
