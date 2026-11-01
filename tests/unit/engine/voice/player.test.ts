import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Player, type AudioLike, type AudioStore } from '@/engine/voice/player/player'
import { FakeTtsBackend } from '@/engine/voice/fakeBackend'

class FakeAudio implements AudioLike {
  src = ''
  currentTime = 0
  playbackRate = 1
  preservesPitch = false
  volume = 1
  paused = true
  durations = new Map<string, number>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private handlers: Record<string, Array<() => void>> = {}
  addEventListener(t: string, fn: () => void) {
    ;(this.handlers[t] ??= []).push(fn)
  }
  removeAttribute() {}
  async play() {
    this.paused = false
    const d = this.durations.get(this.src) ?? 1
    const ms = ((d - this.currentTime) / this.playbackRate) * 1000
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.paused = true
      this.currentTime = d
      this.handlers.ended?.forEach((f) => f())
    }, ms)
  }
  pause() {
    this.paused = true
    if (this.timer) clearTimeout(this.timer)
  }
}

const texts = ['One sentence.', 'Two sentences here.', 'Three.', 'Four is longer than the others.', 'Five.', 'Six.', 'Seven.']

function setup(store?: AudioStore, list: string[] = texts) {
  const backend = new FakeTtsBackend()
  const audio = new FakeAudio()
  let n = 0
  const player = new Player({
    backend,
    audio,
    store,
    prefetch: 3,
    createUrl: (b) => {
      const url = `blob:${++n}`
      audio.durations.set(url, (b.size - 44) / 2 / 8000)
      return url
    },
    revokeUrl: () => {},
  })
  player.setSource({ bookId: 'b', count: list.length, text: (i) => list[i] })
  return { player, backend, audio }
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

describe('Player', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('plays, prefetches 3 ahead and advances sentence by sentence', async () => {
    const { player, backend } = setup()
    const seen: number[] = []
    player.on('sentence', (i) => seen.push(i))
    player.play()
    await flush()
    expect(player.state).toBe('playing')
    expect(backend.calls).toEqual(texts.slice(0, 4))
    await vi.advanceTimersByTimeAsync(FakeTtsBackend.durationFor(texts[0]) * 1000 + 10)
    await flush()
    expect(player.index).toBe(1)
    expect(seen).toEqual([1])
    expect(backend.calls).toEqual(texts.slice(0, 5))
  })

  it('seek bumps the epoch and does not regenerate cached audio', async () => {
    const { player, backend } = setup()
    player.play()
    await flush()
    player.seek(5)
    await flush()
    expect(player.index).toBe(5)
    expect(player.state).toBe('playing')
    const before = backend.calls.length
    player.seek(5, 0.1)
    await flush()
    expect(backend.calls.length).toBe(before)
  })

  it('speed change applies to the audio without regeneration', async () => {
    const { player, backend, audio } = setup()
    player.play()
    await flush()
    const calls = backend.calls.length
    player.setSpeed(1.5)
    expect(audio.playbackRate).toBe(1.5)
    expect(audio.preservesPitch).toBe(true)
    expect(backend.calls.length).toBe(calls)
    // restart the sentence at 2x: 13 chars -> 0.78 s of audio ends in ~0.39 s
    player.setSpeed(2)
    player.seek(0, 0)
    await flush()
    expect(audio.playbackRate).toBe(2)
    expect(backend.calls.length).toBe(calls)
    await vi.advanceTimersByTimeAsync(400)
    await flush()
    expect(player.index).toBe(1)
  })

  it('uses the audio store before generating', async () => {
    const mem = new Map<string, { blob: Blob; duration: number; text: string }>()
    const store: AudioStore = {
      async get(b, i, text) {
        const e = mem.get(`${b}:${i}`)
        return e && e.text === text ? e : null
      },
      async put(b, i, text, blob, duration) {
        mem.set(`${b}:${i}`, { blob, duration, text })
      },
    }
    const a = setup(store)
    a.player.play()
    await flush()
    expect(mem.size).toBe(4)
    const b = setup(store)
    b.player.play()
    await flush()
    expect(b.backend.calls).toEqual([])
  })

  it('pause and resume keep the position', async () => {
    const { player, audio } = setup()
    player.play()
    await flush()
    await vi.advanceTimersByTimeAsync(200)
    audio.currentTime = 0.2
    player.pause()
    expect(player.state).toBe('paused')
    player.play()
    await flush()
    expect(player.state).toBe('playing')
    expect(player.index).toBe(0)
    expect(audio.currentTime).toBe(0.2)
  })

  it('fades out and pauses (sleep timer)', async () => {
    const { player, audio } = setup()
    player.play()
    await flush()
    const done = player.fadeOutAndPause(500)
    await vi.advanceTimersByTimeAsync(250)
    expect(audio.volume).toBeLessThan(0.6)
    expect(audio.volume).toBeGreaterThan(0.4)
    await vi.advanceTimersByTimeAsync(300)
    await done
    expect(player.state).toBe('paused')
    expect(audio.volume).toBe(1)
  })

  it('stops at the end', async () => {
    const { player } = setup()
    player.seek(6, 0, true)
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    await flush()
    expect(player.state).toBe('ended')
  })

  it('prefetches deeper while hidden and keeps that audio when the depth drops again', async () => {
    const many = Array.from({ length: 14 }, (_, i) => `Sentence number ${i + 1}.`)
    const { player, backend } = setup(undefined, many)
    player.play()
    await flush()
    expect(backend.calls).toEqual(many.slice(0, 4))

    // screen locked: generate 8 ahead right away
    player.setPrefetchDepth(8)
    await flush()
    expect(player.prefetchAhead).toBe(8)
    expect(backend.calls).toEqual(many.slice(0, 9))

    // visible again: back to 3 ahead, but already generated audio is not thrown away
    player.setPrefetchDepth(3)
    await vi.advanceTimersByTimeAsync(FakeTtsBackend.durationFor(many[0]) * 1000 + 10)
    await flush()
    expect(player.index).toBe(1)
    expect(player.durationOf(8)).not.toBeNull()
    expect(backend.calls).toEqual(many.slice(0, 9))
  })

  it('does not prefetch when the depth is raised while paused', async () => {
    const many = Array.from({ length: 14 }, (_, i) => `Sentence number ${i + 1}.`)
    const { player, backend } = setup(undefined, many)
    player.setPrefetchDepth(8)
    await flush()
    expect(backend.calls).toEqual([])
    player.play()
    await flush()
    expect(backend.calls).toEqual(many.slice(0, 9))
  })
})

describe('Session prefetch while hidden', () => {
  it('raises the prefetch depth when the page is hidden and restores it when visible', async () => {
    const { session, PREFETCH_HIDDEN, PREFETCH_VISIBLE } = await import('@/session/session')
    const s = session()
    const setVisibility = (v: DocumentVisibilityState) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v })
      document.dispatchEvent(new Event('visibilitychange'))
    }
    expect(s.player.prefetchAhead).toBe(PREFETCH_VISIBLE)
    setVisibility('hidden')
    expect(s.player.prefetchAhead).toBe(PREFETCH_HIDDEN)
    setVisibility('visible')
    expect(s.player.prefetchAhead).toBe(PREFETCH_VISIBLE)
  })
})

describe('Player edge cases', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('a fade-out survives the advance to the next sentence (sleep timer)', async () => {
    const { player } = setup()
    player.play()
    await flush()
    // sentence 0 lasts 0.78 s, much shorter than the 5 s fade
    const done = player.fadeOutAndPause(5000)
    await vi.advanceTimersByTimeAsync(5100)
    await done
    expect(player.index).toBeGreaterThan(0)
    expect(player.state).toBe('paused')
  })

  it('the fade promise settles when the fade is cancelled by a user action', async () => {
    const { player } = setup()
    player.play()
    await flush()
    let settled = false
    void player.fadeOutAndPause(5000).then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(100)
    player.pause()
    await flush()
    expect(settled).toBe(true)
  })

  it('pausing while a resume is still starting does not report an error', async () => {
    const { player, audio } = setup()
    player.play()
    await flush()
    player.pause()
    // a real <audio> rejects a pending play() with AbortError when pause() interrupts it
    let reject: ((e: Error) => void) | null = null
    audio.play = () =>
      new Promise<void>((_, rej) => {
        reject = rej
      })
    player.play()
    player.pause()
    const err = new Error('The play() request was interrupted by a call to pause().')
    err.name = 'AbortError'
    reject!(err)
    await flush()
    expect(player.state).toBe('paused')
  })

  it('play() while already playing does not restart the sentence', async () => {
    const { player, audio } = setup()
    player.play()
    await flush()
    await vi.advanceTimersByTimeAsync(300)
    audio.currentTime = 0.3
    player.play()
    await flush()
    expect(player.state).toBe('playing')
    expect(audio.currentTime).toBe(0.3)
  })

  it('a late duplicate generation does not revoke the URL that is playing', async () => {
    const revoked: string[] = []
    // like the Kokoro worker: one request at a time, and a running request still finishes after cancel()
    const backend = new FakeTtsBackend()
    const inner = backend.generate.bind(backend)
    let queue: Promise<unknown> = Promise.resolve()
    backend.generate = (text, epoch) => {
      const job = queue.then(() => new Promise((r) => setTimeout(r, 100))).then(() => inner(text, epoch))
      queue = job.catch(() => {})
      return job
    }
    backend.cancel = () => {}
    const audio = new FakeAudio()
    let n = 0
    const player = new Player({
      backend,
      audio,
      prefetch: 1,
      createUrl: () => {
        const url = `blob:${++n}`
        audio.durations.set(url, 10)
        return url
      },
      revokeUrl: (u) => revoked.push(u),
    })
    player.setSource({ bookId: 'b', count: texts.length, text: (i) => texts[i] })
    player.play()
    await vi.advanceTimersByTimeAsync(50)
    // seek away and back while sentence 0 is generating: a second job for sentence 0 is queued
    player.seek(1)
    player.seek(0)
    await vi.advanceTimersByTimeAsync(100)
    // the first job finished; tapping the same sentence plays its audio
    player.seek(0, 0.1)
    await flush()
    expect(player.state).toBe('playing')
    const playing = audio.src
    await vi.advanceTimersByTimeAsync(600)
    await flush()
    expect(audio.src).toBe(playing)
    expect(revoked).not.toContain(playing)
  })
})
