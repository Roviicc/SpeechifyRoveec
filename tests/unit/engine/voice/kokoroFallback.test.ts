import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerIn, WorkerOut } from '@/engine/voice/shared/protocol'
import { KokoroBackend } from '@/engine/voice/kokoro/backend'
import { resetGpuCheck } from '@/engine/voice/gpu'

class FakeWorker {
  static all: FakeWorker[] = []
  sent: WorkerIn[] = []
  terminated = false
  onmessage: ((ev: MessageEvent<WorkerOut>) => void) | null = null
  onerror: ((ev: ErrorEvent) => void) | null = null
  constructor() {
    FakeWorker.all.push(this)
  }
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

function setGpu(adapter: boolean | undefined) {
  Object.defineProperty(navigator, 'gpu', {
    configurable: true,
    value: adapter === undefined ? undefined : { requestAdapter: async () => (adapter ? {} : null) },
  })
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const initOf = (w: FakeWorker) => w.sent[0] as Extract<WorkerIn, { type: 'init' }>

describe('Natural voice engine fallback', () => {
  beforeEach(() => {
    FakeWorker.all = []
    vi.stubGlobal('Worker', FakeWorker)
    localStorage.clear()
    resetGpuCheck()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    setGpu(undefined)
  })

  it('no WebGPU at all: starts on the processor', async () => {
    setGpu(undefined)
    const k = new KokoroBackend()
    const ready = k.init()
    await flush()
    expect(FakeWorker.all).toHaveLength(1)
    expect(initOf(FakeWorker.all[0])).toMatchObject({ device: 'wasm', dtype: 'q8' })
    FakeWorker.all[0].emit({ type: 'ready', info: { device: 'wasm', dtype: 'q8' } })
    const info = await ready
    expect(info.device).toBe('wasm')
    expect(info.gpuFailed).toBeUndefined()
  })

  it('WebGPU but no adapter: the processor too', async () => {
    setGpu(false)
    const k = new KokoroBackend()
    void k.init()
    await flush()
    expect(initOf(FakeWorker.all[0]).device).toBe('wasm')
  })

  it('GPU first (even when the old setting said Processor); a failing GPU falls back to the processor silently', async () => {
    setGpu(true)
    localStorage.setItem('lumen-voice-engine', 'cpu')
    const k = new KokoroBackend()
    const ready = k.init()
    await flush()
    expect(localStorage.getItem('lumen-voice-engine')).toBeNull()
    const gpu = FakeWorker.all[0]
    expect(initOf(gpu)).toMatchObject({ device: 'webgpu', dtype: 'fp32' })
    // e.g. the GPU can't run the model
    gpu.emit({ type: 'error', message: 'WebGPU device lost' })
    await flush()
    expect(gpu.terminated).toBe(true)
    const cpu = FakeWorker.all[1]
    expect(initOf(cpu).device).toBe('wasm')
    cpu.emit({ type: 'ready', info: { device: 'wasm', dtype: 'q8' } })
    const info = await ready
    expect(info).toMatchObject({ device: 'wasm', gpuFailed: true })
  })

  it('a GPU that works is kept, however slow its start-up test was (no switch to the processor)', async () => {
    setGpu(true)
    const k = new KokoroBackend()
    const ready = k.init()
    await flush()
    FakeWorker.all[0].emit({ type: 'testing' })
    FakeWorker.all[0].emit({ type: 'ready', info: { device: 'webgpu', dtype: 'fp32', testRtf: 2.5 } })
    expect((await ready).device).toBe('webgpu')
    expect(FakeWorker.all).toHaveLength(1)
  })

  it('an extra preparing worker (only: webgpu) never falls back to the processor', async () => {
    setGpu(true)
    const k = new KokoroBackend({ only: 'webgpu' })
    const ready = k.init()
    await flush()
    expect(initOf(FakeWorker.all[0]).device).toBe('webgpu')
    FakeWorker.all[0].emit({ type: 'error', message: 'out of memory' })
    await expect(ready).rejects.toThrow(/another voice worker/)
    expect(FakeWorker.all).toHaveLength(1)
  })
})
