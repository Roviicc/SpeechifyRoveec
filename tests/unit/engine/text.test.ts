import { describe, expect, it } from 'vitest'
import { splitSentences, splitWords } from '@/engine/text/segment'
import { findInlineSkips, isPageNumberLine } from '@/engine/text/smartSkip'
import { compileDictionary, findPronunciations } from '@/engine/text/pronounce'
import { buildSpoken, resolveOverlaps } from '@/engine/text/spoken'
import { wordIndexAt, wordTimings } from '@/engine/text/timing'
import { DEFAULT_SKIP } from '@/engine/text/types'

const sentences = (t: string, max?: number) => splitSentences(t, max).map((s) => t.slice(s.start, s.end))

describe('splitSentences', () => {
  it('keeps abbreviations, initials and decimals together', () => {
    expect(sentences('Dr. Smith arrived at 3.14 p.m. on Monday. He left, e.g. early. J. R. R. Tolkien wrote it.')).toEqual([
      'Dr. Smith arrived at 3.14 p.m. on Monday.',
      'He left, e.g. early.',
      'J. R. R. Tolkien wrote it.',
    ])
  })

  it('keeps "Chapter III." headings together', () => {
    expect(sentences('Chapter III. A Caucus-Race and a Long Tale')).toEqual(['Chapter III. A Caucus-Race and a Long Tale'])
    expect(sentences('Part 2. The Return')).toEqual(['Part 2. The Return'])
  })

  it('splits after "no." used as a word but keeps "No. 5" / "p. 7" references', () => {
    expect(sentences('He said no. Then he left.')).toEqual(['He said no.', 'Then he left.'])
    expect(sentences('See fig. 3 and no. 4 here. Then p. 7 too.')).toEqual(['See fig. 3 and no. 4 here.', 'Then p. 7 too.'])
  })

  it('handles quotes, ellipses and question marks', () => {
    expect(sentences('“Is it true?” she asked. Well… maybe. Yes!')).toEqual(['“Is it true?” she asked.', 'Well… maybe.', 'Yes!'])
  })

  it('splits sentences longer than the limit at natural breaks', () => {
    const long = Array.from({ length: 30 }, (_, i) => `clause number ${i} goes here`).join(', ') + '.'
    const parts = sentences(long, 120)
    expect(parts.length).toBeGreaterThan(5)
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(120)
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(long)
  })

  it('returns offsets into the original text', () => {
    const t = '  Hello there.   General Kenobi!  '
    const spans = splitSentences(t)
    expect(spans.map((s) => t.slice(s.start, s.end))).toEqual(['Hello there.', 'General Kenobi!'])
  })
})

describe('smart skip', () => {
  it('skips bracket and author-year citations', () => {
    const t = 'Water boils [12] at sea level (Smith, 2020) and also [3-5] here (Lee & Park 2019; Ode et al., 2021, p. 4).'
    const reps = findInlineSkips(t, DEFAULT_SKIP)
    const skipped = reps.filter((r) => r.kind === 'citation').map((r) => t.slice(r.start, r.end).trim())
    expect(skipped).toEqual(['[12]', '[3-5]', '(Smith, 2020)', '(Lee & Park 2019; Ode et al., 2021, p. 4)'])
  })

  it('does not treat ordinary parentheses as citations', () => {
    expect(findInlineSkips('He was (as usual) late in 2020 (for once).', DEFAULT_SKIP)).toEqual([])
  })

  it('reads URLs as "link" and trims trailing punctuation', () => {
    const t = 'See https://example.com/a?b=1. Or www.test.org, ok.'
    const reps = findInlineSkips(t, DEFAULT_SKIP)
    expect(reps.map((r) => [t.slice(r.start, r.end), r.say])).toEqual([
      ['https://example.com/a?b=1', 'link'],
      ['www.test.org', 'link'],
    ])
  })

  it('finds footnote markers', () => {
    const t = 'This is true.¹ And this.12 Then 3 apples.'
    const reps = findInlineSkips(t, DEFAULT_SKIP).map((r) => t.slice(r.start, r.end))
    expect(reps).toContain('¹')
    expect(reps).toContain('12')
    expect(reps).not.toContain('3')
  })

  it('does not skip exponents, page/number references or dates in parentheses', () => {
    for (const t of [
      'The area is 10 m² and E = mc² holds, about 10³ km².',
      'Prices fell (March 2020) sharply and recovered (Summer 2021) slowly.',
      'See p.12 for details and turn to No.5 now.',
    ])
      expect(findInlineSkips(t, DEFAULT_SKIP).map((r) => t.slice(r.start, r.end))).toEqual([])
    const t = 'A claim word² and more.'
    expect(findInlineSkips(t, DEFAULT_SKIP).map((r) => t.slice(r.start, r.end))).toEqual(['²'])
  })

  it('respects toggles', () => {
    const t = 'A [1] b https://x.io.'
    expect(findInlineSkips(t, { ...DEFAULT_SKIP, citations: false, urls: false })).toEqual([])
  })

  it('recognises page number lines', () => {
    for (const s of ['12', '- 12 -', 'Page 3', '3 of 10', 'xiv']) expect(isPageNumberLine(s)).toBe(true)
    for (const s of ['12 Angry Men', 'Chapter 3', 'I am', 'Hello']) expect(isPageNumberLine(s)).toBe(false)
  })
})

describe('pronunciation', () => {
  it('replaces whole words case-insensitively', () => {
    const dict = compileDictionary([
      { word: 'Kubernetes', say: 'koo-ber-net-eez' },
      { word: 'SQL', say: 'sequel' },
    ])
    const t = 'kubernetes and SQL, not SQLite.'
    const reps = findPronunciations(t, dict)
    expect(reps.map((r) => [t.slice(r.start, r.end), r.say])).toEqual([
      ['kubernetes', 'koo-ber-net-eez'],
      ['SQL', 'sequel'],
    ])
  })
})

describe('spoken text + word timing', () => {
  it('builds spoken text with skips and replacements', () => {
    const t = 'Water boils [12] at https://x.io today.'
    const reps = resolveOverlaps(findInlineSkips(t, DEFAULT_SKIP))
    const sp = buildSpoken(t, 0, t.length, reps)
    expect(sp.text).toBe('Water boils at link today.')
    const words = sp.words.map((w) => t.slice(w.start, w.end))
    expect(words).toEqual(['Water', 'boils', 'at', 'https', 'x.io', 'today'].filter((w) => words.includes(w)))
    expect(words).not.toContain('12')
  })

  it('returns empty text for sentences that are entirely skipped', () => {
    const t = '[12]'
    expect(buildSpoken(t, 0, t.length, findInlineSkips(t, DEFAULT_SKIP)).text).toBe('')
  })

  it('word timings are monotonic and fit the duration', () => {
    const t = 'The quick, brown fox jumps over the lazy dog. Hyphen-ated words too.'
    const sp = buildSpoken(t, 0, t.length, [])
    const tm = wordTimings(sp, 4)
    expect(tm.length).toBe(splitWords(t).length)
    for (let i = 0; i < tm.length; i++) {
      expect(tm[i].t1).toBeGreaterThan(tm[i].t0)
      if (i) expect(tm[i].t0).toBeCloseTo(tm[i - 1].t1)
    }
    expect(tm[tm.length - 1].t1).toBeLessThanOrEqual(4)
    expect(tm[tm.length - 1].t1).toBeGreaterThan(3.5)
    // longer words get more time
    const quick = tm.find((w) => t.slice(w.start, w.end) === 'quick')!
    const the = tm[0]
    expect(quick.t1 - quick.t0).toBeGreaterThan(the.t1 - the.t0)
    expect(wordIndexAt(tm, 0)).toBe(-1)
    expect(wordIndexAt(tm, tm[3].t0 + 0.001)).toBe(3)
  })
})
