import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildBookIndex } from '@/engine/book/bookIndex'
import type { BookDoc } from '@/engine/book/types'
import { DEFAULT_SKIP } from '@/engine/text/types'
import { estimateTimes, playedFraction, refineSecondsPerChar, sentenceAtFraction } from '@/session/estimates'
import { locatorOf, sectionJumpTarget } from '@/session/navigation'
import { reachedChapterEnd, SleepTimer, type SentenceStep } from '@/session/sleepTimer'
import type { SleepTimer as SleepState } from '@/state/playback'
import { SlowVoiceDetector, slowVoiceAction } from '@/session/voiceAutoSwitch'
import { ProgressSaver, progressRecord, type ProgressInput } from '@/session/progressSaver'
import { deviceLabel } from '@/session/modelLoader'
import { indexSettingsKey, resolveStart } from '@/session/indexing'
import { prefetchDepth, PREFETCH_HIDDEN, PREFETCH_VISIBLE } from '@/session/visibility'

const doc: BookDoc = {
  version: 1,
  type: 'epub',
  title: 'T',
  toc: [],
  sections: [
    { title: 'One', blocks: [{ text: 'Chapter one.', kind: 'h' }, { text: 'A first. A second. A third.', kind: 'p' }] },
    { title: 'Empty', blocks: [] },
    { title: 'Two', blocks: [{ text: 'Chapter two.', kind: 'h' }, { text: 'B first. B second. B third. B fourth.', kind: 'p' }] },
    { title: 'Three', blocks: [{ text: 'Chapter three.', kind: 'h' }, { text: 'C first. C second.', kind: 'p' }] },
  ],
}
// sentences: 0-3 section 0, (section 1 empty), 4-8 section 2, 9-11 section 3
const idx = buildBookIndex(doc, { skip: DEFAULT_SKIP, dictionary: [] })

describe('estimates', () => {
  it('has no estimate without an index', () => {
    expect(estimateTimes(null, 0, 0, 0.068, 1)).toEqual({ elapsed: 0, total: 0, sectionRemaining: 0 })
  })

  it('counts elapsed, total and the rest of the section in spoken characters', () => {
    const e = estimateTimes(idx, 4, 0.5, 1, 1)
    expect(e.total).toBe(idx.totalChars)
    expect(e.elapsed).toBe(idx.cumChars[4] + idx.sentences[4].chars / 2)
    expect(e.sectionRemaining).toBe(idx.cumChars[9] - e.elapsed)
  })

  it('scales with speed', () => {
    expect(estimateTimes(idx, 0, 0, 0.1, 2).total).toBeCloseTo((idx.totalChars * 0.1) / 2)
  })

  it('played fraction is clamped and 0 without audio', () => {
    expect(playedFraction(1, null)).toBe(0)
    expect(playedFraction(1, 4)).toBe(0.25)
    expect(playedFraction(5, 4)).toBe(1)
  })

  it('maps a fraction of the book to a sentence', () => {
    expect(sentenceAtFraction(null, 0.5)).toBe(0)
    expect(sentenceAtFraction(idx, 0)).toBe(0)
    expect(sentenceAtFraction(idx, 1)).toBe(idx.sentences.length - 1)
    const i = sentenceAtFraction(idx, 0.5)
    expect(idx.cumChars[i]).toBeLessThanOrEqual(idx.totalChars / 2)
    expect(idx.cumChars[i + 1]).toBeGreaterThan(idx.totalChars / 2)
  })

  it('refines seconds per char only from long sentences with audio', () => {
    expect(refineSecondsPerChar(0.07, 3, 10)).toBe(0.07)
    expect(refineSecondsPerChar(0.07, 0, 100)).toBe(0.07)
    expect(refineSecondsPerChar(0.07, 10, 100)).toBeCloseTo(0.07 * 0.9 + 0.1 * 0.1)
  })
})

describe('navigation', () => {
  it('locator of a sentence', () => {
    expect(locatorOf(idx, 4)).toEqual({ section: 2, block: idx.sentences[4].block, offset: idx.sentences[4].start })
    expect(locatorOf(idx, 99)).toBeNull()
    expect(locatorOf(null, 0)).toBeNull()
  })

  it('next section skips empty sections and stops at the last one', () => {
    expect(sectionJumpTarget(idx, 1, 1)).toBe(4)
    expect(sectionJumpTarget(idx, 5, 1)).toBe(9)
    expect(sectionJumpTarget(idx, 10, 1)).toBeNull()
  })

  it('previous section goes to the start of this section first', () => {
    expect(sectionJumpTarget(idx, 7, -1)).toBe(4)
    expect(sectionJumpTarget(idx, 5, -1)).toBe(0)
    expect(sectionJumpTarget(idx, 1, -1)).toBeNull()
  })

  it('resolves a start position', () => {
    expect(resolveStart(idx)).toBe(0)
    expect(resolveStart(idx, 7)).toBe(7)
    expect(resolveStart(idx, locatorOf(idx, 9)!)).toBe(9)
  })
})

describe('sleep timer', () => {
  const step = (s: Partial<SentenceStep>): SentenceStep => ({ prevIndex: 3, prevSection: 0, index: 4, section: 1, active: true, ...s })

  it('end of chapter only on natural read-on into a new section while playing', () => {
    expect(reachedChapterEnd('chapter', step({}))).toBe(true)
    expect(reachedChapterEnd('off', step({}))).toBe(false)
    expect(reachedChapterEnd('minutes', step({}))).toBe(false)
    expect(reachedChapterEnd('chapter', step({ index: 9 }))).toBe(false) // jumped
    expect(reachedChapterEnd('chapter', step({ section: 0 }))).toBe(false) // same section
    expect(reachedChapterEnd('chapter', step({ active: false }))).toBe(false)
  })

  describe('SleepTimer', () => {
    let state: SleepState
    let fades: number[]
    let timer: SleepTimer
    beforeEach(() => {
      vi.useFakeTimers()
      state = { mode: 'off' }
      fades = []
      timer = new SleepTimer({ fadeOut: (ms) => fades.push(ms), publish: (s) => (state = s), getState: () => state, now: () => 1000 })
    })
    afterEach(() => vi.useRealTimers())

    it('minutes: publishes the end time and fades over the last 5 s', () => {
      timer.set(1)
      expect(state).toEqual({ mode: 'minutes', minutes: 1, endsAt: 61_000 })
      vi.advanceTimersByTime(54_999)
      expect(fades).toEqual([])
      vi.advanceTimersByTime(1)
      expect(fades).toEqual([5000])
      expect(state).toEqual({ mode: 'off' })
    })

    it('turning it off cancels the pending fade', () => {
      timer.set(1)
      timer.set('off')
      vi.advanceTimersByTime(120_000)
      expect(fades).toEqual([])
      expect(state).toEqual({ mode: 'off' })
    })

    it('end of chapter fades out at the next chapter, then switches off', () => {
      timer.set('chapter')
      timer.onSentence(step({ section: 0, index: 3, prevIndex: 2 }))
      expect(fades).toEqual([])
      timer.onSentence(step({}))
      expect(fades).toEqual([3000])
      expect(state).toEqual({ mode: 'off' })
    })
  })
})

describe('voice auto switch', () => {
  it('fires once after 4 slow Kokoro sentences', () => {
    const d = new SlowVoiceDetector()
    expect([1, 2, 3].map(() => d.observe(2, 1, 'kokoro'))).toEqual([false, false, false])
    expect(d.observe(2, 1, 'kokoro')).toBe(true)
    expect(d.observe(2, 1, 'kokoro')).toBe(false)
    d.reset()
    expect([1, 2, 3, 4].map(() => d.observe(2, 1, 'kokoro'))).toEqual([false, false, false, true])
  })

  it('takes speed into account and ignores Piper', () => {
    const d = new SlowVoiceDetector()
    for (let i = 0; i < 6; i++) expect(d.observe(1, 1.2, 'kokoro')).toBe(false) // 1.2 <= 1.3
    expect(d.observe(1, 1.5, 'kokoro')).toBe(true)
    const p = new SlowVoiceDetector()
    for (let i = 0; i < 6; i++) expect(p.observe(5, 1, 'piper')).toBe(false)
  })

  it('switches in Auto, only hints for a fixed choice', () => {
    expect(slowVoiceAction('auto')).toBe('switch')
    expect(slowVoiceAction('kokoro')).toBe('hint')
  })
})

describe('progress saver', () => {
  const book = { id: 'b', title: 'T', doc, persist: true }

  it('builds the progress row for the current sentence', () => {
    expect(progressRecord({ book, index: idx, sentence: 4 })).toEqual({
      bookId: 'b',
      sentence: 4,
      locator: locatorOf(idx, 4),
      percent: idx.cumChars[4] / idx.totalChars,
      sectionTitle: 'Two',
    })
    expect(progressRecord({ book: { ...book, persist: false }, index: idx, sentence: 4 })).toBeNull()
    expect(progressRecord({ book, index: null, sentence: 0 })).toBeNull()
    expect(progressRecord({ book: null, index: idx, sentence: 0 })).toBeNull()
  })

  it('throttles saves while playing', async () => {
    let now = 10_000
    const saved: ProgressInput[] = []
    const sentence = { i: 0 }
    const saver = new ProgressSaver(() => ({ book, index: idx, sentence: sentence.i }), async (p) => void saved.push(p), () => now)
    saver.saveIfDue()
    sentence.i = 1
    now += 4000
    saver.saveIfDue()
    expect(saved.map((p) => p.sentence)).toEqual([0])
    now += 1
    saver.saveIfDue()
    await saver.saveNow()
    expect(saved.map((p) => p.sentence)).toEqual([0, 1, 1])
  })
})

describe('small helpers', () => {
  it('device label', () => {
    expect(deviceLabel({ device: 'wasm', dtype: 'q8' })).toBe('wasm / q8')
    expect(deviceLabel({ device: 'wasm', dtype: 'q8', gpuRejected: { rtf: 3.21 }, autoSwitched: { kokoroRtf: 2 } })).toBe(
      'auto→piper · wasm / q8 (GPU too slow: RTF 3.2)',
    )
    expect(deviceLabel({ device: 'wasm', dtype: 'q8', gpuRejected: { rtf: null } })).toBe('wasm / q8 (GPU too slow)')
  })

  it('index key changes with smart skip and pronunciation only', () => {
    const a = indexSettingsKey({ skip: DEFAULT_SKIP, dictionary: [] })
    expect(indexSettingsKey({ skip: { ...DEFAULT_SKIP }, dictionary: [] })).toBe(a)
    expect(indexSettingsKey({ skip: DEFAULT_SKIP, dictionary: [{ word: 'a', say: 'b' }] })).not.toBe(a)
  })

  it('prefetch depth', () => {
    expect(prefetchDepth(false)).toBe(PREFETCH_VISIBLE)
    expect(prefetchDepth(true)).toBe(PREFETCH_HIDDEN)
  })
})
