import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookDoc } from '../../src/engine/doc/types'

vi.mock('../../src/engine/tts/select', async () => {
  const { FakeTtsBackend } = await import('../../src/engine/tts/fakeBackend')
  return { createBackend: () => new FakeTtsBackend(), isFakeVoice: () => true }
})
vi.mock('../../src/data/audioCache', () => ({ audioStore: { voice: () => '', get: async () => null, put: async () => {} } }))
vi.mock('../../src/data/repo', () => ({ saveProgress: async () => {} }))

/** <audio> stand-in: "plays" for the WAV's duration, then fires ended. */
class FakeAudio {
  src = ''
  currentTime = 0
  playbackRate = 1
  preservesPitch = true
  volume = 1
  paused = true
  private timer: ReturnType<typeof setTimeout> | null = null
  private handlers: Record<string, Array<() => void>> = {}
  addEventListener(t: string, fn: () => void) {
    ;(this.handlers[t] ??= []).push(fn)
  }
  removeAttribute() {}
  async play() {
    this.paused = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.paused = true
      this.handlers.ended?.forEach((f) => f())
    }, 1000 / this.playbackRate)
  }
  pause() {
    this.paused = true
    if (this.timer) clearTimeout(this.timer)
  }
}

const doc: BookDoc = {
  version: 1,
  type: 'epub',
  title: 'T',
  toc: [],
  sections: [
    { title: 'One', blocks: [{ text: 'Chapter one.', kind: 'h' }, { text: 'A first. A second. A third.', kind: 'p' }] },
    { title: 'Two', blocks: [{ text: 'Chapter two.', kind: 'h' }, { text: 'B first. B second. B third. B fourth.', kind: 'p' }] },
    { title: 'Three', blocks: [{ text: 'Chapter three.', kind: 'h' }, { text: 'C first. C second.', kind: 'p' }] },
  ],
}

type SessionMod = typeof import('../../src/app/session')
type Store = typeof import('../../src/store/settings')
let mod: SessionMod
let settings: Store

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

describe('Session', () => {
  beforeAll(async () => {
    vi.stubGlobal('Audio', FakeAudio)
    mod = await import('../../src/app/session')
    settings = await import('../../src/store/settings')
  })
  beforeEach(() => {
    vi.useFakeTimers()
    const s = mod.session()
    s.close()
    s.setSleep('off')
    s.open({ id: 'book', title: 'T', doc, persist: false }, 0)
  })
  afterEach(() => vi.useRealTimers())

  it('"end of chapter" sleep stops when reading on into the next chapter', async () => {
    const s = mod.session()
    s.setSleep('chapter')
    s.play()
    await flush()
    expect(s.player.state).toBe('playing')
    // 4 sentences in chapter one, 1 s each; then a 3 s fade
    await vi.advanceTimersByTimeAsync(4000 + 3500)
    expect(s.player.state).toBe('paused')
    expect(s.index!.sentences[s.player.index].section).toBe(1)
  })

  it('"end of chapter" sleep does not stop playback when the user jumps to another chapter', async () => {
    const s = mod.session()
    s.setSleep('chapter')
    s.play()
    await flush()
    s.nextSection(1)
    await flush()
    await vi.advanceTimersByTimeAsync(3500)
    expect(s.player.state).toBe('playing')
    expect(s.index!.sentences[s.player.index].section).toBe(1)
  })

  it('applies a speed that arrived through sync to the player', async () => {
    const s = mod.session()
    const cur = settings.settingsSnapshot()
    settings.useSettings.getState().replace({ ...cur, speed: 1.7, updatedAt: cur.updatedAt + 1 })
    expect(s.player.speed).toBe(1.7)
  })
})
