import { describe, expect, it } from 'vitest'
import { LumenDB } from '@/data/db'
import { DexieAudioStore } from '@/data/audioCache'
import { FakeTtsBackend } from '@/engine/voice/fakeBackend'
import { PriorityBackend } from '@/engine/voice/priorityBackend'
import { Player, type AudioLike } from '@/engine/voice/player/player'
import { buildBookIndex } from '@/engine/book/bookIndex'
import { DEFAULT_SKIP } from '@/engine/text/types'
import type { BookDoc } from '@/engine/book/types'
import { Preparer, type PreparerDeps, type PreparerState } from '@/session/preparer'

let n = 0
const identity = async (b: Blob) => b

function setup(opts: { texts?: string[]; delayMs?: number; deps?: Partial<PreparerDeps>; busy?: () => boolean } = {}) {
  const texts = opts.texts ?? ['One.', 'Two two.', 'Three three three.', 'Four.', 'Five.', 'Six.']
  const db = new LumenDB(`prep-${++n}`)
  const store = new DexieAudioStore(db, 10_000_000, identity)
  const fake = new FakeTtsBackend({ delayMs: opts.delayMs })
  const backend = new PriorityBackend(fake, opts.busy)
  const marks: number[] = []
  const states: PreparerState[] = []
  const preparer = new Preparer({
    generate: (t) => backend.generateBackground(t),
    store,
    voice: () => 'kokoro',
    sentences: async () => texts,
    onSentence: (_b, i) => marks.push(i),
    retryDelayMs: 1,
    ...opts.deps,
  })
  preparer.subscribe((s) => states.push(s))
  store.voice = () => 'kokoro'
  return { texts, db, store, fake, backend, preparer, marks, states }
}

describe('Preparer', () => {
  it('generates every sentence of the range into the cache, marked prepared, with progress', async () => {
    const { preparer, store, fake, marks, states, texts } = setup()
    preparer.enqueue('b', 1, 4, 'Chapter')
    await preparer.idle()
    expect(fake.calls).toEqual(texts.slice(1, 5))
    expect(marks.sort()).toEqual([1, 2, 3, 4])
    const items = texts.map((text, index) => ({ index, text }))
    const { cached, prepared } = await store.lookup('b', items, 'kokoro')
    expect([...cached].sort()).toEqual([1, 2, 3, 4])
    expect([...prepared].sort()).toEqual([1, 2, 3, 4])
    // progress went 0 -> 4 of 4, then the run ended
    const progress = states.filter((s) => s.current).map((s) => s.current!.done)
    expect(progress[0]).toBe(0)
    expect(progress.at(-1)).toBe(4)
    expect(states.filter((s) => s.current).every((s) => s.current!.total === 4)).toBe(true)
    expect(states.at(-1)!.current).toBeNull()
    expect(states.some((s) => s.current?.etaSec != null)).toBe(true)
    expect(await store.preparedUsage()).toEqual(new Map([['b', { bytes: expect.any(Number), count: 4 }]]))
  })

  it('skips sentences that are already cached for this voice and protects them from eviction', async () => {
    const { preparer, store, fake, texts } = setup()
    await store.put('b', 0, texts[0], new Blob([new Uint8Array(10)]), 1)
    // another voice's audio does not count
    store.voice = () => 'piper'
    await store.put('b', 1, texts[1], new Blob([new Uint8Array(10)]), 1)
    store.voice = () => 'kokoro'
    preparer.enqueue('b', 0, 2, 'Chapter')
    await preparer.idle()
    expect(fake.calls).toEqual([texts[1], texts[2]])
    const { prepared } = await store.lookup('b', texts.slice(0, 3).map((text, index) => ({ index, text })), 'kokoro')
    expect([...prepared].sort()).toEqual([0, 1, 2])
  })

  it('never generates smart-skipped text (it is not in the sentence list)', async () => {
    const doc: BookDoc = {
      version: 1,
      type: 'pdf',
      title: 'T',
      toc: [],
      sections: [
        {
          title: 'P1',
          blocks: [
            { text: 'Running Header', kind: 'p', skip: 'header' },
            { text: 'Real text here. And more.', kind: 'p' },
            { text: '12', kind: 'p', skip: 'pagenum' },
          ],
        },
      ],
    }
    const idx = buildBookIndex(doc, { skip: DEFAULT_SKIP, dictionary: [] })
    const texts = idx.sentences.map((s) => s.spoken.text)
    const { preparer, fake } = setup({ texts })
    preparer.enqueue('b', 0, texts.length - 1, 'Whole book')
    await preparer.idle()
    expect(fake.calls).toEqual(['Real text here.', 'And more.'])
  })

  it('runs jobs one at a time in order, ignores duplicates, and can cancel one or all', async () => {
    const { preparer, fake, texts } = setup({ delayMs: 15 })
    const a = preparer.enqueue('b', 0, 2, 'A')
    expect(preparer.enqueue('b', 0, 2, 'A')).toBe(a)
    preparer.enqueue('b', 3, 5, 'B')
    expect(preparer.snapshot.queue.map((j) => j.label)).toEqual(['B'])
    expect(preparer.snapshot.current?.job.label).toBe('A')
    // cancel A after its first sentence: B starts
    await new Promise((r) => setTimeout(r, 25))
    preparer.cancel(a)
    await preparer.idle()
    expect(fake.calls.slice(-3)).toEqual(texts.slice(3, 6))
    expect(fake.calls).not.toContain(texts[2])

    // cancel everything
    fake.calls.length = 0
    preparer.enqueue('c', 0, 5, 'C')
    preparer.enqueue('c', 0, 1, 'D')
    await new Promise((r) => setTimeout(r, 5))
    preparer.cancel()
    await preparer.idle()
    expect(fake.calls.length).toBeLessThanOrEqual(1)
    expect(preparer.snapshot).toMatchObject({ current: null, queue: [] })
  })

  it('yields to the player: background work waits while a player request is running', async () => {
    const { preparer, fake, backend, texts } = setup({ delayMs: 20 })
    // the player asks for a sentence first
    const live = backend.generate('Player sentence.', 1)
    preparer.enqueue('b', 0, 1, 'A')
    // and another one while the first background sentence would be waiting
    await new Promise((r) => setTimeout(r, 5))
    const live2 = backend.generate('Player prefetch.', 1)
    await Promise.all([live, live2])
    await preparer.idle()
    expect(fake.calls.slice(0, 2)).toEqual(['Player sentence.', 'Player prefetch.'])
    expect(fake.calls.slice(2)).toEqual(texts.slice(0, 2))
  })

  it("a player seek (epoch cancel) doesn't drop background work", async () => {
    const { preparer, fake, backend } = setup({ delayMs: 5 })
    preparer.enqueue('b', 0, 2, 'A')
    backend.cancel(5)
    backend.cancel(6)
    await preparer.idle()
    expect(fake.calls).toHaveLength(3)
  })

  it('waits while the player is reading the cache before it generates (busy signal)', async () => {
    let busy = true
    const { preparer, fake } = setup({ busy: () => busy })
    preparer.enqueue('b', 0, 0, 'A')
    await new Promise((r) => setTimeout(r, 80))
    expect(fake.calls).toHaveLength(0)
    busy = false
    await preparer.idle()
    expect(fake.calls).toHaveLength(1)
  })

  it('stops with a message when storage is full', async () => {
    const { preparer, fake, states } = setup({ deps: { hasRoom: async () => false } })
    preparer.enqueue('b', 0, 3, 'A')
    preparer.enqueue('b', 4, 5, 'B')
    await preparer.idle()
    expect(fake.calls).toHaveLength(0)
    expect(states.at(-1)!.error).toMatch(/Storage is full/)
    expect(states.at(-1)!.queue).toEqual([])
  })

  it('rests between sentences on lighter settings', async () => {
    const full = setup({ delayMs: 20 })
    let t0 = performance.now()
    full.preparer.enqueue('b', 0, 2, 'A')
    await full.preparer.idle()
    const fullMs = performance.now() - t0

    const light = setup({ delayMs: 20, deps: { restFactor: () => 1.5 } })
    t0 = performance.now()
    light.preparer.enqueue('b', 0, 2, 'A')
    await light.preparer.idle()
    const lightMs = performance.now() - t0
    expect(lightMs).toBeGreaterThan(fullMs + 60)
  })

  it('the player plays prepared audio without generating it again', async () => {
    const { preparer, store, fake, texts } = setup()
    preparer.enqueue('b', 0, 2, 'A')
    await preparer.idle()
    fake.calls.length = 0
    const audio: AudioLike = {
      src: '',
      currentTime: 0,
      playbackRate: 1,
      preservesPitch: true,
      volume: 1,
      paused: true,
      play: async () => {},
      pause: () => {},
      removeAttribute: () => {},
      addEventListener: () => {},
    }
    const player = new Player({ backend: fake, store, audio, prefetch: 2, createUrl: () => 'blob:x', revokeUrl: () => {} })
    player.setSource({ bookId: 'b', count: texts.length, text: (i) => texts[i] })
    player.play()
    await new Promise((r) => setTimeout(r, 50))
    expect(player.state).toBe('playing')
    expect(fake.calls).toEqual([])
    player.destroy()
  })
})

describe('DexieAudioStore and prepared audio', () => {
  it('eviction never removes prepared audio; a later player write keeps the mark', async () => {
    const db = new LumenDB(`prep-${++n}`)
    const store = new DexieAudioStore(db, 2500, identity)
    const blob = (size: number) => new Blob([new Uint8Array(size)])
    await store.putPrepared('b', 0, 'kept', blob(3000), 1)
    await store.put('b', 1, 'one', blob(1000), 1)
    await new Promise((r) => setTimeout(r, 5))
    await store.put('b', 2, 'two', blob(1000), 1)
    await new Promise((r) => setTimeout(r, 5))
    await store.put('b', 3, 'three', blob(1000), 1)
    await store.evict()
    expect(await store.get('b', 0, 'kept')).not.toBeNull()
    expect(await store.get('b', 1, 'one')).toBeNull()
    expect(await store.totalSize()).toBeLessThanOrEqual(2500)
    // the player writing the same sentence again (same voice and text) keeps it prepared
    await store.put('b', 0, 'kept', blob(3000), 1)
    expect((await store.preparedUsage()).get('b')?.count).toBe(1)
    await store.clear()
    expect(await store.get('b', 0, 'kept')).not.toBeNull()
    await store.deletePrepared('b')
    expect(await store.get('b', 0, 'kept')).toBeNull()
  })
})
