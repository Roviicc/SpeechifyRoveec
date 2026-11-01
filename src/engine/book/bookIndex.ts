import { splitSentences } from '@/engine/text/segment'
import { findInlineSkips, isPageNumberLine } from '@/engine/text/smartSkip'
import { compileDictionary, findPronunciations } from '@/engine/text/pronounce'
import { buildSpoken, resolveOverlaps, type SpokenText } from '@/engine/text/spoken'
import type { PronunciationEntry, Replacement, SkipOptions } from '@/engine/text/types'
import type { Block, BookDoc } from './types'

export interface FlatBlock extends Block {
  /** global block index */
  index: number
  section: number
  /** ranges that are visible but not read (for dimmed styling) */
  skipped: Array<[number, number]>
  /** whole block is skipped */
  skippedAll: boolean
}

export interface SentenceRef {
  block: number
  start: number
  end: number
  section: number
  spoken: SpokenText
  /** characters of spoken text — used for time estimates */
  chars: number
}

export interface BookIndex {
  blocks: FlatBlock[]
  sentences: SentenceRef[]
  /** first global block index of every section */
  sectionBlockStart: number[]
  /** first sentence index of every section (sentences.length if the section has none) */
  sectionSentenceStart: number[]
  /** prefix sums of spoken characters: cumChars[i] = chars before sentence i */
  cumChars: number[]
  totalChars: number
}

export interface IndexOptions {
  skip: SkipOptions
  dictionary: PronunciationEntry[]
  maxSentence?: number
}

function blockSkipped(b: Block, skip: SkipOptions): boolean {
  if ((b.skip === 'header' || b.skip === 'footer') && skip.headersFooters) return true
  if (skip.pageNumbers && (b.skip === 'pagenum' || isPageNumberLine(b.text))) return true
  return false
}

/** Flatten a document into blocks + sentences ready for playback. Pure and deterministic. */
export function buildBookIndex(doc: BookDoc, opts: IndexOptions): BookIndex {
  const dict = compileDictionary(opts.dictionary)
  const blocks: FlatBlock[] = []
  const sentences: SentenceRef[] = []
  const sectionBlockStart: number[] = []
  const sectionSentenceStart: number[] = []
  doc.sections.forEach((section, si) => {
    sectionBlockStart.push(blocks.length)
    sectionSentenceStart.push(sentences.length)
    for (const b of section.blocks) {
      const index = blocks.length
      const skippedAll = blockSkipped(b, opts.skip)
      const flat: FlatBlock = { ...b, index, section: si, skipped: [], skippedAll }
      blocks.push(flat)
      if (skippedAll) continue
      const inline = findInlineSkips(b.text, opts.skip, b.notes)
      const reps: Replacement[] = resolveOverlaps([...inline, ...findPronunciations(b.text, dict)])
      flat.skipped = inline.filter((r) => r.say === '').map((r) => [r.start, r.end])
      for (const span of splitSentences(b.text, opts.maxSentence ?? 400)) {
        const spoken = buildSpoken(b.text, span.start, span.end, reps)
        if (!spoken.text) continue
        sentences.push({ block: index, start: span.start, end: span.end, section: si, spoken, chars: spoken.text.length })
      }
    }
  })
  const cumChars: number[] = new Array(sentences.length + 1)
  cumChars[0] = 0
  for (let i = 0; i < sentences.length; i++) cumChars[i + 1] = cumChars[i] + sentences[i].chars
  return {
    blocks,
    sentences,
    sectionBlockStart,
    sectionSentenceStart,
    cumChars,
    totalChars: cumChars[sentences.length],
  }
}

/** Sentence index containing (block, offset), or the next sentence after it. */
export function sentenceAt(index: BookIndex, block: number, offset: number): number {
  const s = index.sentences
  let lo = 0
  let hi = s.length - 1
  let ans = s.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const m = s[mid]
    if (m.block > block || (m.block === block && m.end > offset)) {
      ans = mid
      hi = mid - 1
    } else lo = mid + 1
  }
  return Math.max(0, ans)
}


/** Last sentence index of the section that contains sentence i. */
export function sectionEndSentence(index: BookIndex, section: number): number {
  for (let s = section + 1; s < index.sectionSentenceStart.length; s++) {
    if (index.sectionSentenceStart[s] > index.sectionSentenceStart[section]) return index.sectionSentenceStart[s] - 1
  }
  return index.sentences.length - 1
}
