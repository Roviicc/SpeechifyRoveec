import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkerVoiceClient, type LaunchOptions } from '../../src/engine/tts/workerVoiceClient'
import type { WorkerIn, WorkerOut } from '../../src/engine/tts/protocol'
import { CancelledError, type LoadProgress, type TtsInfo } from '../../src/engine/tts/types'

class FakeWorker {
  sent: WorkerIn[] = []
  terminated = false
  onmessage: ((ev: MessageEvent<WorkerOut>) => void) | null = null
  onerror: ((ev: ErrorEvent) => void) | null = null
  postMessage(m: WorkerIn) {
    this.sent.push(m)
  }
  terminate() {
    this.terminated = true
  }
  emit(m: WorkerOut) {
    this.onmessage?.({ data: m } as MessageEvent<WorkerOut>)
  }
}

const INFO: TtsInfo = { device: 'wasm', dtype: 'q8', testRtf: 0.5 }

function options(over: Partial<LaunchOptions> = {}): LaunchOptions {
  return {
    init: { type: 'init', device: 'wasm', dtype: 'q8' },
    silenceMs: 1000,
    silenceError: (downloading) => new Error(downloading ? 'stalled' : 'stuck'),
    testTimeoutMs: 500,
    testTimeoutError: () => new Error('test timeout'),
    startError: (m) => new Error(`start: ${m}`),
    crashError: () => new Error('crash'),
    ...over,
  }
}

function start(over: Partial<LaunchOptions> = {}) {
  const client = new WorkerVoiceClient()
  const worker = new FakeWorker()
  const progress: LoadProgress[] = []
  const ready = client.launch(() => worker as unknown as Worker, options(over), (p) => progress.push(p))
  return { client, worker, progress, ready }
}

describe('WorkerVoiceClient', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends init, sums progress over files and resolves on ready', async () => {
    const { client, worker, progress, ready } = start()
    expect(worker.sent[0]).toEqual({ type: 'init', device: 'wasm', dtype: 'q8' })
    worker.emit({ type: 'progress', file: 'a', loaded: 50, total: 100, status: 'progress' })
    worker.emit({ type: 'progress', file: 'b', loaded: 0, total: 300, status: 'progress' })
    expect(progress.at(-1)).toEqual({ fraction: 50 / 400, loadedBytes: 50, totalBytes: 400, status: 'downloading' })
    worker.emit({ type: 'progress', file: 'a', loaded: 100, total: 100, status: 'done' })
    worker.emit({ type: 'progress', file: 'b', loaded: 300, total: 300, status: 'done' })
    expect(progress.at(-1)?.status).toBe('loading')
    worker.emit({ type: 'testing' })
    worker.emit({ type: 'ready', info: INFO })
    await expect(ready).resolves.toEqual(INFO)
    expect(client.info).toEqual(INFO)
    expect(progress.at(-1)?.status).toBe('ready')
  })

  it('matches audio, cancellations and errors to their requests', async () => {
    const { client, worker, ready } = start()
    worker.emit({ type: 'ready', info: INFO })
    await ready
    const a = client.generate('one', 1)
    const b = client.generate('two', 1)
    const c = client.generate('three', 1)
    const ids = worker.sent.filter((m) => m.type === 'generate').map((m) => (m as { reqId: number }).reqId)
    worker.emit({ type: 'cancelled', reqId: ids[1] })
    worker.emit({ type: 'error', reqId: ids[2], message: 'boom' })
    worker.emit({ type: 'audio', reqId: ids[0], epoch: 1, wav: new ArrayBuffer(48), duration: 1.5, genMs: 300 })
    const got = await a
    expect(got.duration).toBe(1.5)
    expect(got.wav.type).toBe('audio/wav')
    await expect(b).rejects.toBeInstanceOf(CancelledError)
    await expect(c).rejects.toThrow('boom')
    client.cancel(2)
    expect(worker.sent.at(-1)).toEqual({ type: 'cancel', epoch: 2 })
  })

  it('gives up on a silent worker, telling a stalled download from a stuck engine', async () => {
    const s1 = start()
    s1.worker.emit({ type: 'progress', file: 'a', loaded: 10, total: 100, status: 'progress' })
    vi.advanceTimersByTime(1000)
    await expect(s1.ready).rejects.toThrow('stalled')
    expect(s1.worker.terminated).toBe(true)

    const s2 = start()
    vi.advanceTimersByTime(999)
    s2.worker.emit({ type: 'progress', file: 'a', loaded: 100, total: 100, status: 'done' }) // re-arms
    vi.advanceTimersByTime(999)
    s2.worker.emit({ type: 'progress', file: 'a', loaded: 100, total: 100, status: 'done' })
    vi.advanceTimersByTime(1000)
    await expect(s2.ready).rejects.toThrow('stuck')
  })

  it('times the speed test separately and can reject the ready info', async () => {
    const s1 = start()
    s1.worker.emit({ type: 'testing' })
    vi.advanceTimersByTime(500)
    await expect(s1.ready).rejects.toThrow('test timeout')

    const s2 = start({ rejectReady: (i) => ((i.testRtf ?? 0) > 0.4 ? new Error('slow') : null) })
    s2.worker.emit({ type: 'ready', info: INFO })
    await expect(s2.ready).rejects.toThrow('slow')
    expect(s2.worker.terminated).toBe(true)
    expect(s2.client.info).toBeNull()
  })

  it('maps start-up errors and crashes, and reset fails waiting requests', async () => {
    const s1 = start()
    s1.worker.emit({ type: 'error', message: 'no model' })
    await expect(s1.ready).rejects.toThrow('start: no model')

    const s2 = start()
    s2.worker.onerror?.({ message: 'x' } as ErrorEvent)
    await expect(s2.ready).rejects.toThrow('crash')

    const s3 = start()
    s3.worker.emit({ type: 'ready', info: INFO })
    await s3.ready
    const pending = s3.client.generate('one', 1)
    s3.client.reset()
    await expect(pending).rejects.toBeInstanceOf(CancelledError)
    expect(s3.worker.terminated).toBe(true)
    expect(s3.client.info).toBeNull()
  })
})

describe('serveVoice', () => {
  let posted: WorkerOut[]
  let fakeSelf: { onmessage: ((ev: MessageEvent<WorkerIn>) => void) | null; postMessage: (m: WorkerOut) => void; crossOriginIsolated: boolean }

  beforeEach(() => {
    posted = []
    fakeSelf = { onmessage: null, postMessage: (m) => posted.push(m), crossOriginIsolated: false }
    vi.stubGlobal('self', fakeSelf)
    vi.resetModules()
  })
  afterEach(() => vi.unstubAllGlobals())

  const send = (m: WorkerIn) => fakeSelf.onmessage?.({ data: m } as MessageEvent<WorkerIn>)
  const settle = async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve()
  }

  it('loads, warms up, reports test RTF, then serves jobs and drops cancelled epochs', async () => {
    const { serveVoice } = await import('../../src/engine/tts/serveVoice')
    const spoken: string[] = []
    let release: (() => void) | null = null
    serveVoice({
      async load(_msg, progress) {
        progress({ file: 'm', loaded: 1, total: 1, status: 'done' })
        return {
          info: { device: 'wasm', dtype: 'q8' },
          async synth(text) {
            spoken.push(text)
            if (text === 'slow') await new Promise<void>((r) => (release = r))
            return { samples: new Float32Array(2400).fill(0.5), sampleRate: 24000 }
          },
        }
      },
    })
    send({ type: 'init', device: 'wasm', dtype: 'q8' })
    await settle()
    expect(posted.map((m) => m.type)).toEqual(['progress', 'testing', 'ready'])
    const ready = posted[2] as Extract<WorkerOut, { type: 'ready' }>
    expect(ready.info.device).toBe('wasm')
    expect(typeof ready.info.testRtf).toBe('number')
    expect(spoken).toEqual(['Hello.', 'This is a short test of the reading voice.'])

    posted = []
    send({ type: 'generate', reqId: 1, epoch: 0, text: 'slow' })
    send({ type: 'generate', reqId: 2, epoch: 0, text: 'dropped' })
    send({ type: 'generate', reqId: 3, epoch: 1, text: 'kept' })
    send({ type: 'cancel', epoch: 1 })
    expect(posted).toEqual([{ type: 'cancelled', reqId: 2 }])
    release!()
    await settle()
    const audio = posted.filter((m) => m.type === 'audio') as Extract<WorkerOut, { type: 'audio' }>[]
    expect(audio.map((m) => m.reqId)).toEqual([1, 3])
    expect(audio[0].duration).toBeCloseTo(0.1)
    expect(spoken.slice(2)).toEqual(['slow', 'kept'])
  })

  it('reports a failed load as an error without reqId', async () => {
    const { serveVoice } = await import('../../src/engine/tts/serveVoice')
    serveVoice({
      load: async () => {
        throw new Error('no network')
      },
    })
    send({ type: 'init', device: 'wasm', dtype: 'q8' })
    await settle()
    expect(posted).toEqual([{ type: 'error', message: 'no network' }])
  })
})
