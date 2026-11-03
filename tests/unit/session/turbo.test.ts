import { describe, expect, it } from 'vitest'
import { LumenDB } from '@/data/db'
import { DexieAudioStore } from '@/data/audioCache'
import { FakeTtsBackend } from '@/engine/voice/fakeBackend'
import { PriorityBackend } from '@/engine/voice/priorityBackend'
import { BackgroundLanes } from '@/engine/voice/backgroundLanes'
import { createPrepareWorker, turboAllowed } from '@/engine/voice/select'
import type { GeneratedAudio, LoadProgress, TtsBackend, TtsInfo } from '@/engine/voice/types'
import { Preparer, type PreparerState } from '@/session/preparer'
import { formatRealtime, restAfter, Throughput } from '@/session/dutyCycle'
import { clampUsage, migrateSettings } from '@/state/settings'
import { showTurbo, naturalOnGpu } from '@/features/settings/gpuStatus'

let n = 0
const identity = async (b: Blob) => b
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A fake voice that records how many requests run at the same time. */
class CountingBackend implements TtsBackend {
  info: TtsInfo | null = null
  calls: string[] = []
  disposed = false
  constructor(
    private readonly shared: { now: number; max: number },
    private readonly opts: { delayMs?: number; failInit?: boolean; failGenerate?: boolean } = {},
  ) {}
  async init(_p?: (p: LoadProgress) => void): Promise<TtsInfo> {
    if (this.opts.failInit) throw new Error('GPU out of memory')
    this.info = { device: 'fake', dtype: 'none' }
    return this.info
  }
  async generate(text: string): Promise<GeneratedAudio> {
    await this.init()
    if (this.opts.failGenerate) throw new Error('device lost')
    this.calls.push(text)
    this.shared.now++
    this.shared.max = Math.max(this.shared.max, this.shared.now)
    await sleep(this.opts.delayMs ?? 20)
    this.shared.now--
    const fake = new FakeTtsBackend()
    return { ...(await fake.generate(text, 0)), genMs: this.opts.delayMs ?? 20 }
  }
  cancel() {}
  reset() {
    this.disposed = true
  }
}

function setup(opts: { workers?: () => number; extra?: { failInit?: boolean; failGenerate?: boolean }; texts?: string[] } = {}) {
  const texts = opts.texts ?? Array.from({ length: 8 }, (_, i) => `Sentence number ${i}.`)
  const db = new LumenDB(`turbo-${++n}`)
  const store = new DexieAudioStore(db, 10_000_000, identity)
  store.voice = () => 'kokoro'
  const shared = { now: 0, max: 0 }
  const main = new CountingBackend(shared)
  const priority = new PriorityBackend(main)
  const extras: CountingBackend[] = []
  const failures: Array<{ lane: number; workers: number }> = []
  const lanes = new BackgroundLanes({
    create: () => {
      const b = new CountingBackend(shared, opts.extra)
      extras.push(b)
      return b
    },
    waitForPlayer: () => priority.waitForPlayer(),
    onFailed: (lane, workers) => failures.push({ lane, workers }),
  })
  const states: PreparerState[] = []
  const preparer = new Preparer({
    generate: (t, lane) => (lane === 0 ? priority.generateBackground(t) : lanes.generate(lane, t)),
    lanes: () => Math.min(opts.workers?.() ?? 2, lanes.limit),
    store,
    voice: () => 'kokoro',
    sentences: async () => texts,
    retryDelayMs: 1,
  })
  preparer.subscribe((s) => {
    states.push(s)
    if (!s.current && !s.queue.length) lanes.dispose()
  })
  return { texts, store, shared, main, priority, extras, lanes, preparer, states, failures }
}

describe('duty cycle', () => {
  it('rests synthesis time × (100/usage − 1)', () => {
    expect(restAfter(100, 100)).toBe(0)
    expect(restAfter(100, 50)).toBeCloseTo(100)
    expect(restAfter(100, 20)).toBeCloseTo(400)
    expect(restAfter(120, 40)).toBeCloseTo(180)
    expect(restAfter(100, 70)).toBeCloseTo(42.857, 2)
    expect(restAfter(0, 20)).toBe(0)
    // out-of-range values are clamped, never negative
    expect(restAfter(100, 150)).toBe(0)
    expect(restAfter(100, NaN)).toBe(0)
  })

  it('measured speed: sentences/min, ×real time and ms per character over the window', () => {
    const t = new Throughput(60_000)
    expect(t.stats()).toBeNull()
    t.start(0)
    t.add(100, 6, 500)
    t.add(100, 6, 1000)
    const st = t.stats()!
    expect(st.perMin).toBeCloseTo(120)
    expect(st.xRealtime).toBeCloseTo(12)
    expect(st.msPerChar).toBeCloseTo(5)
    // old events fall out of the window
    t.add(100, 1, 70_000)
    expect(t.stats()!.perMin).toBeCloseTo(60_000 / 69_000)
    expect(formatRealtime(11.4)).toBe('×11 real time')
    expect(formatRealtime(2.34)).toBe('×2.3 real time')
  })
})

describe('settings migration', () => {
  it('maps the old preparing speed to GPU usage', () => {
    expect(migrateSettings({ prepareSpeed: 'full', theme: 'dark' }, 1)).toEqual({ prepareUsage: 100, theme: 'dark' })
    expect(migrateSettings({ prepareSpeed: 'balanced' }, 1)).toEqual({ prepareUsage: 70 })
    expect(migrateSettings({ prepareSpeed: 'light' }, 1)).toEqual({ prepareUsage: 40 })
    expect(migrateSettings({ prepareSpeed: 'weird' }, 1)).toEqual({})
    expect(migrateSettings({}, 0)).toEqual({})
    expect(migrateSettings({ prepareUsage: 55, prepareWorkers: 7 }, 2)).toEqual({ prepareUsage: 60, prepareWorkers: 1 })
    expect(clampUsage(5)).toBe(20)
    expect(clampUsage(130)).toBe(100)
  })
})

describe('Turbo: extra preparing workers', () => {
  it('two sentences in flight, all prepared once, extra worker disposed when the queue empties', async () => {
    const { preparer, shared, main, extras, store, texts, states, lanes } = setup()
    preparer.enqueue('b', 0, texts.length - 1, 'Whole book')
    await preparer.idle()
    expect(shared.max).toBe(2)
    expect(extras).toHaveLength(1)
    const all = [...main.calls, ...extras[0].calls].sort()
    expect(all).toEqual([...texts].sort())
    expect(main.calls.length).toBeGreaterThan(0)
    expect(extras[0].calls.length).toBeGreaterThan(0)
    const { prepared } = await store.lookup('b', texts.map((text, index) => ({ index, text })), 'kokoro')
    expect(prepared.size).toBe(texts.length)
    expect(states.some((s) => s.current?.workers === 2)).toBe(true)
    expect(states.some((s) => (s.current?.stats?.xRealtime ?? 0) > 0)).toBe(true)
    expect(extras[0].disposed).toBe(true)
    expect(lanes.running).toBe(0)
  })

  it('three workers when asked', async () => {
    const { preparer, shared, extras, texts } = setup({ workers: () => 3 })
    preparer.enqueue('b', 0, texts.length - 1, 'Whole book')
    await preparer.idle()
    expect(shared.max).toBe(3)
    expect(extras).toHaveLength(2)
    expect(extras.every((e) => e.disposed)).toBe(true)
  })

  it('Off = one at a time, no extra worker', async () => {
    const { preparer, shared, extras, texts } = setup({ workers: () => 1 })
    preparer.enqueue('b', 0, 3, 'A')
    await preparer.idle()
    expect(shared.max).toBe(1)
    expect(extras).toHaveLength(0)
    expect(texts).toHaveLength(8)
  })

  it('every lane yields to the player', async () => {
    const { preparer, priority, main, extras } = setup()
    // the player is busy: nothing of the preparer may start
    const live = priority.generate('Player sentence.', 1)
    preparer.enqueue('b', 0, 5, 'A')
    await sleep(5)
    const live2 = priority.generate('Player prefetch.', 1)
    await Promise.all([live, live2])
    expect(main.calls.slice(0, 2)).toEqual(['Player sentence.', 'Player prefetch.'])
    // the extra lane only started after the player's requests
    await preparer.idle()
    expect(extras[0].calls.length).toBeGreaterThan(0)
  })

  it('turning Turbo off mid-run stops the extra lane; the main lane finishes the job', async () => {
    let workers = 2
    const { preparer, main, extras, texts, lanes } = setup({ workers: () => workers })
    preparer.enqueue('b', 0, texts.length - 1, 'Whole book')
    await sleep(30)
    workers = 1
    lanes.trim(1)
    await preparer.idle()
    const all = [...main.calls, ...extras.flatMap((e) => e.calls)]
    expect(new Set(all).size).toBe(texts.length)
    expect(extras[0].disposed).toBe(true)
  })

  it('a worker that fails to load drops back to fewer workers; the run still completes', async () => {
    const { preparer, main, extras, texts, failures, lanes, states, store } = setup({ workers: () => 3, extra: { failInit: true } })
    preparer.enqueue('b', 0, texts.length - 1, 'Whole book')
    await preparer.idle()
    expect(failures[0]).toEqual({ lane: 1, workers: 1 })
    expect(lanes.limit).toBe(1)
    expect(main.calls.sort()).toEqual([...texts].sort())
    expect(extras.length).toBeGreaterThan(0)
    expect(states.at(-1)!.error).toBeUndefined()
    const { prepared } = await store.lookup('b', texts.map((text, index) => ({ index, text })), 'kokoro')
    expect(prepared.size).toBe(texts.length)
  })

  it('a worker that crashes while generating gives its sentence back', async () => {
    const { preparer, main, texts, failures } = setup({ extra: { failGenerate: true } })
    preparer.enqueue('b', 0, texts.length - 1, 'Whole book')
    await preparer.idle()
    expect(failures).toHaveLength(1)
    expect(main.calls.sort()).toEqual([...texts].sort())
  })
})

describe('Turbo only on the GPU', () => {
  it('extra workers only for the Natural voice on WebGPU (or the fake voice)', () => {
    expect(turboAllowed({ device: 'webgpu', dtype: 'fp32' }, 'kokoro')).toBe(true)
    expect(turboAllowed({ device: 'wasm', dtype: 'q8' }, 'kokoro')).toBe(false)
    expect(turboAllowed({ device: 'webgpu', dtype: 'fp32' }, 'piper')).toBe(false)
    expect(turboAllowed(null, 'kokoro')).toBe(false)
    expect(createPrepareWorker({ device: 'wasm', dtype: 'q8' }, 'kokoro')).toBeNull()
    expect(createPrepareWorker({ device: 'fake', dtype: 'none' }, 'kokoro')).toBeInstanceOf(FakeTtsBackend)
  })

  it('the Turbo control is shown only with a usable GPU and the Natural voice', () => {
    expect(showTurbo(true, 'kokoro', undefined)).toBe(true)
    expect(showTurbo(true, 'kokoro', 'webgpu')).toBe(true)
    expect(showTurbo(true, 'kokoro', 'wasm')).toBe(false)
    expect(showTurbo(false, 'kokoro', undefined)).toBe(false)
    expect(showTurbo(true, 'piper', 'webgpu')).toBe(false)
    expect(naturalOnGpu(false, 'fake')).toBe(false)
  })
})
