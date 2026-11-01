import { useMemo, useState } from 'react'
import { Play } from 'lucide-react'
import { Sheet } from '@/ui/Sheet'
import type { BookIndex } from '@/engine/book/bookIndex'
import type { BookDoc } from '@/engine/book/types'

export interface SearchHit {
  block: number
  start: number
  end: number
  section: number
}

const MAX_RESULTS = 300

function findHits(index: BookIndex | null, q: string): SearchHit[] {
  const query = q.trim().toLowerCase()
  if (!index || query.length < 2) return []
  const out: SearchHit[] = []
  for (const b of index.blocks) {
    const t = b.text.toLowerCase()
    let from = 0
    let k: number
    while ((k = t.indexOf(query, from)) >= 0) {
      out.push({ block: b.index, start: k, end: k + query.length, section: b.section })
      from = k + query.length
      if (out.length >= MAX_RESULTS) return out
    }
  }
  return out
}

export function SearchSheet({
  open,
  onClose,
  index,
  doc,
  onJump,
}: {
  open: boolean
  onClose: () => void
  index: BookIndex | null
  doc: BookDoc
  onJump: (hit: SearchHit, play: boolean) => void
}) {
  const [q, setQ] = useState('')
  const results = useMemo(() => findHits(index, q), [q, index])
  return (
    <Sheet open={open} onClose={onClose} title="Search in book" testId="search-sheet" maxHeight="90vh">
      <input
        data-autofocus
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search words or phrases"
        aria-label="Search in book"
        data-testid="search-input"
        className="mb-3 h-12 w-full rounded-full bg-surface px-5 text-[15px] outline-none focus:ring-2 focus:ring-primary"
      />
      {q.trim().length >= 2 && (
        <p className="mb-2 text-sm text-muted" aria-live="polite">
          {results.length >= MAX_RESULTS ? `${MAX_RESULTS}+` : results.length} results
        </p>
      )}
      <ul>
        {index &&
          results.map((r, i) => {
            const text = index.blocks[r.block].text
            const a = Math.max(0, r.start - 50)
            const b = Math.min(text.length, r.end + 70)
            return (
              <li key={i} className="flex items-start gap-1 border-b border-line">
                <button className="flex-1 py-3 text-left" onClick={() => onJump(r, false)} data-testid="search-result">
                  <span className="block text-xs text-muted">{doc.sections[r.section]?.title}</span>
                  <span className="text-[15px]">
                    {a > 0 && '…'}
                    {text.slice(a, r.start)}
                    <mark className="rounded bg-yellow-300/70 px-0.5 text-inherit">{text.slice(r.start, r.end)}</mark>
                    {text.slice(r.end, b)}
                    {b < text.length && '…'}
                  </span>
                </button>
                <button aria-label="Start reading here" className="mt-2 grid h-10 w-10 shrink-0 place-items-center rounded-full text-primary hover:bg-surface" onClick={() => onJump(r, true)}>
                  <Play size={18} fill="currentColor" />
                </button>
              </li>
            )
          })}
      </ul>
    </Sheet>
  )
}
