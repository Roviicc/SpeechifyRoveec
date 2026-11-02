import { describe, expect, it } from 'vitest'
import { buildBookIndex, sentenceAt, sectionEndSentence } from '@/engine/book/bookIndex'
import type { BookDoc } from '@/engine/book/types'
import { DEFAULT_SKIP } from '@/engine/text/types'

const doc: BookDoc = {
  version: 1,
  type: 'pdf',
  title: 'T',
  toc: [],
  sections: [
    {
      title: 'Page 1',
      blocks: [
        { text: 'Running Header', kind: 'p', skip: 'header' },
        { text: 'First sentence. Second one [4].', kind: 'p' },
        { text: '1', kind: 'p' },
      ],
    },
    { title: 'Page 2', blocks: [{ text: '[7]', kind: 'p' }, { text: 'Third sentence here.', kind: 'p' }] },
  ],
}

describe('buildBookIndex', () => {
  it('skips headers, page numbers and empty sentences', () => {
    const idx = buildBookIndex(doc, { skip: DEFAULT_SKIP, dictionary: [] })
    expect(idx.sentences.map((s) => s.spoken.text)).toEqual(['First sentence.', 'Second one.', 'Third sentence here.'])
    expect(idx.blocks[0].skippedAll).toBe(true)
    expect(idx.blocks[2].skippedAll).toBe(true)
    expect(idx.sectionSentenceStart).toEqual([0, 2])
    expect(sectionEndSentence(idx, 0)).toBe(1)
    expect(sectionEndSentence(idx, 1)).toBe(2)
    expect(idx.totalChars).toBe(idx.cumChars[3])
  })

  it('reads everything when smart skip is off', () => {
    const off = { headersFooters: false, pageNumbers: false, citations: false, footnotes: false, urls: false, footnoteText: false, captions: false, tables: false }
    const idx = buildBookIndex(doc, { skip: off, dictionary: [{ word: 'third', say: '3rd' }] })
    expect(idx.sentences.map((s) => s.spoken.text)).toEqual([
      'Running Header',
      'First sentence.',
      'Second one [4].',
      '1',
      '[7]',
      '3rd sentence here.',
    ])
  })

  it('finds the sentence at a block offset', () => {
    const idx = buildBookIndex(doc, { skip: DEFAULT_SKIP, dictionary: [] })
    expect(sentenceAt(idx, 1, 0)).toBe(0)
    expect(sentenceAt(idx, 1, 20)).toBe(1)
    expect(sentenceAt(idx, 3, 0)).toBe(2) // skipped block -> next sentence
    expect(sentenceAt(idx, 4, 5)).toBe(2)
  })
})
