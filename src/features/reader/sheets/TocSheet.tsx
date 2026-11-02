import { useEffect, useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import { Sheet } from '@/ui/Sheet'
import { Segmented, formatMinutes } from '@/ui/controls'
import { session } from '@/session/session'
import { usePlayback } from '@/state/playback'
import type { BookIndex } from '@/engine/book/bookIndex'
import type { BookDoc } from '@/engine/book/types'
import { PageGrid } from './PageGrid'
import { tocRanges, type TocRange } from './tocRanges'

type Tab = 'contents' | 'pages'

export function TocSheet({
  open,
  onClose,
  doc,
  index,
  file,
}: {
  open: boolean
  onClose: () => void
  doc: BookDoc
  index: BookIndex | null
  /** the original PDF (enables the Pages tab) */
  file?: Blob | null
}) {
  const section = usePlayback((s) => s.section)
  const at = usePlayback((s) => s.index)
  const speed = usePlayback((s) => s.speed)
  const [tab, setTab] = useState<Tab>('contents')
  const hasPages = doc.type === 'pdf' && !!file
  const showPages = hasPages && tab === 'pages'

  const ranges = useMemo(() => (index ? tocRanges(doc.toc, index) : null), [doc.toc, index])
  const current = useMemo(() => {
    let c = -1
    if (ranges) ranges.forEach((r, i) => r.start <= at && r.end >= r.start && (c = i))
    else doc.toc.forEach((t, i) => t.section <= section && (c = i))
    return c
  }, [ranges, doc.toc, section, at])

  const currentPage = index?.blocks[index.sentences[at]?.block ?? -1]?.page ?? 0

  useEffect(() => {
    if (open && !showPages) requestAnimationFrame(() => document.querySelector('[data-toc-current="true"]')?.scrollIntoView({ block: 'center' }))
  }, [open, showPages])

  const minutes = (r: TocRange) => {
    if (!index || r.start > r.end) return ''
    return formatMinutes(((index.cumChars[r.end + 1] - index.cumChars[r.start]) * session().secondsPerChar) / speed)
  }
  const percent = (r: TocRange) => {
    if (!index || r.start > r.end) return 0
    const total = index.cumChars[r.end + 1] - index.cumChars[r.start]
    return total > 0 ? Math.max(0, Math.min(100, Math.round(((index.cumChars[at] - index.cumChars[r.start]) / total) * 100))) : 0
  }

  const jumpToPage = (page: number) => {
    if (!index) return
    const b = index.blocks.find((x) => x.page === page && !x.skippedAll && x.text.trim())
    // a page with nothing to read: go to the next page that has something
    const target = b ?? index.blocks.find((x) => (x.page ?? -1) > page && !x.skippedAll && x.text.trim())
    if (!target) return
    session().seekTo({ section: target.section, block: target.index, offset: 0 })
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title="Contents" testId="toc-sheet">
      {hasPages && (
        <div className="sticky top-0 z-10 -mx-5 bg-bg px-5 pb-3" data-testid="toc-tabs">
          <Segmented
            label="Show"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'contents', label: 'Contents' },
              { value: 'pages', label: 'Pages' },
            ]}
          />
        </div>
      )}
      {showPages ? (
        <PageGrid file={file!} current={currentPage} onPick={jumpToPage} />
      ) : doc.toc.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">This book has no table of contents.</p>
      ) : (
        <ul>
          {doc.toc.map((t, i) => {
            const r = ranges?.[i]
            const isCurrent = i === current
            const done = !!r && !isCurrent && r.end >= r.start && r.end < at
            const pct = isCurrent && r ? percent(r) : 0
            const right = isCurrent && r ? `${pct}%` : done ? '' : t.level === 0 && r ? minutes(r) : ''
            return (
              <li key={i}>
                <button
                  data-toc-current={isCurrent}
                  data-toc-done={done || undefined}
                  aria-current={isCurrent ? 'location' : undefined}
                  aria-label={`${t.title}${isCurrent ? `, ${pct}% read` : done ? ', finished' : ''}`}
                  onClick={() => {
                    const block = r?.block ?? (index?.sectionBlockStart[t.section] ?? 0) + (t.block ?? 0)
                    session().seekTo({ section: t.section, block, offset: 0 })
                    onClose()
                  }}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left ${
                    isCurrent ? 'bg-primary-soft font-semibold text-primary' : 'hover:bg-surface'
                  }`}
                  style={{ paddingLeft: 8 + t.level * 16 }}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className={`truncate ${done ? 'text-muted' : ''}`}>{t.title}</span>
                    {isCurrent && r && (
                      <span className="block h-1 w-full overflow-hidden rounded-full bg-primary/20" aria-hidden data-testid="toc-progress">
                        <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                      </span>
                    )}
                  </span>
                  {done ? (
                    <Check size={16} className="shrink-0 text-muted" aria-hidden data-testid="toc-done" />
                  ) : (
                    right && <span className={`shrink-0 text-xs tabular-nums ${isCurrent ? 'text-primary' : 'text-muted'}`}>{right}</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Sheet>
  )
}
