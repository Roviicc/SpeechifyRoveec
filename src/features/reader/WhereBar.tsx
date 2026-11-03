import { useMemo } from 'react'
import type { BookIndex } from '@/engine/book/bookIndex'
import { sentenceAt } from '@/engine/book/bookIndex'
import type { BookDoc } from '@/engine/book/types'
import { usePlayback } from '@/state/playback'
import { usePrepare } from '@/state/prepare'
import { PrepareIndicator } from './PrepareIndicator'

/** Chapter title for a section: its own title, without the " · p. N" page suffix PDFs add. */
export function chapterName(doc: BookDoc, section: number): string {
  const t = doc.sections[section]?.title ?? ''
  return t.split(' · ')[0]
}

/** Where the reader is in the book, for the line under the top bar and the progress-bar bubble. */
export function whereLabel(doc: BookDoc, index: BookIndex, block: number): { primary: string; percent: number } {
  const b = index.blocks[block]
  const sentence = sentenceAt(index, block, 0)
  const percent = index.totalChars ? Math.round((index.cumChars[sentence] / index.totalChars) * 100) : 0
  if (!b) return { primary: '', percent }
  if (doc.type === 'pdf') {
    const page = (b.page ?? b.section) + 1
    const name = chapterName(doc, b.section)
    const showName = name && !/^Page \d+$/.test(name)
    return { primary: `Page ${page} of ${doc.sections.length}${showName ? ` · ${name}` : ''}`, percent }
  }
  return { primary: chapterName(doc, b.section), percent }
}

/**
 * The quiet line under the top bar: which chapter (or page) is on screen and how far into the book, like
 * Apple Books' "4 pages left in chapter". Follows what the reader is looking at, falling back to the voice.
 */
export function WhereBar({ doc, index, viewBlock }: { doc: BookDoc; index: BookIndex | null; viewBlock: number | null }) {
  const voiceIndex = usePlayback((s) => s.index)
  const label = useMemo(() => {
    if (!index) return null
    const block = viewBlock ?? index.sentences[voiceIndex]?.block
    return block === undefined ? null : whereLabel(doc, index, block)
  }, [doc, index, viewBlock, voiceIndex])
  const preparing = usePrepare((s) => !!s.current)
  const prep = <PrepareIndicator className="absolute top-1/2 right-4 -translate-y-1/2" />
  if (!label?.primary) return <div className="relative h-7 shrink-0 bg-bg">{prep}</div>
  return (
    <div className={`relative flex h-7 shrink-0 items-center justify-center bg-bg text-xs ${preparing ? 'px-16' : 'px-4'} text-muted`} data-testid="where-bar">
      <span className="flex min-w-0 items-center gap-1.5" aria-live="polite">
        <span className="min-w-0 truncate">{label.primary}</span>
        <span aria-hidden>·</span>
        <span className="shrink-0 tabular-nums">{label.percent}%</span>
      </span>
      {prep}
    </div>
  )
}
