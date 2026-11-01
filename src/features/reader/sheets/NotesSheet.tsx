import { useState } from 'react'
import { Bookmark, Trash2 } from 'lucide-react'
import { Sheet } from '@/ui/Sheet'
import { Segmented } from '@/ui/controls'
import type { BookDoc } from '@/engine/book/types'
import type { BookmarkRow, HighlightRow } from '@/data/db'
import { deleteBookmark, deleteHighlight, updateHighlight } from '@/data/repo'
import { HIGHLIGHT_COLORS } from './constants'

type Loc = { section: number; block: number; offset: number }

function BookmarkList({ bookmarks, doc, onJump }: { bookmarks: BookmarkRow[]; doc: BookDoc; onJump: (loc: Loc) => void }) {
  if (!bookmarks.length) return <p className="py-8 text-center text-muted">No bookmarks yet. Tap the bookmark icon at the top while reading.</p>
  return (
    <ul>
      {bookmarks.map((b) => (
        <li key={b.id} className="flex items-center gap-2 border-b border-line" data-testid="bookmark-item">
          <Bookmark size={18} className="shrink-0 text-primary" fill="currentColor" />
          <button className="min-w-0 flex-1 py-3 text-left" onClick={() => onJump(b.locator)}>
            <span className="block text-xs text-muted">{doc.sections[b.locator.section]?.title}</span>
            <span className="line-clamp-2 text-[15px]">{b.label}</span>
          </button>
          <button aria-label="Delete bookmark" className="grid h-10 w-10 place-items-center rounded-full text-muted hover:bg-surface" onClick={() => void deleteBookmark(b.id)}>
            <Trash2 size={18} />
          </button>
        </li>
      ))}
    </ul>
  )
}

export function NotesSheet({
  open,
  onClose,
  bookmarks,
  highlights,
  doc,
  onJump,
}: {
  open: boolean
  onClose: () => void
  bookmarks: BookmarkRow[]
  highlights: HighlightRow[]
  doc: BookDoc
  onJump: (loc: Loc) => void
}) {
  const [tab, setTab] = useState<'bookmarks' | 'highlights'>('bookmarks')
  const [editing, setEditing] = useState<string | null>(null)
  const [note, setNote] = useState('')
  return (
    <Sheet open={open} onClose={onClose} title="Notes & Bookmarks" testId="notes-sheet" maxHeight="90vh">
      <div className="mb-3">
        <Segmented
          label="Show"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'bookmarks', label: `Bookmarks (${bookmarks.length})` },
            { value: 'highlights', label: `Highlights (${highlights.length})` },
          ]}
        />
      </div>
      {tab === 'bookmarks' ? (
        <BookmarkList bookmarks={bookmarks} doc={doc} onJump={onJump} />
      ) : highlights.length ? (
        <ul>
          {highlights.map((h) => (
            <li key={h.id} className="border-b border-line py-2" data-testid="highlight-item">
              <div className="flex items-start gap-2">
                <span className="mt-1.5 h-3 w-3 shrink-0 rounded-full" style={{ background: HIGHLIGHT_COLORS.find((c) => c.color === h.color)?.css }} />
                <button className="min-w-0 flex-1 text-left" onClick={() => onJump(h.start)}>
                  <span className="block text-xs text-muted">{doc.sections[h.start.section]?.title}</span>
                  <span className="line-clamp-3 text-[15px]">“{h.text}”</span>
                  {h.note && editing !== h.id && <span className="mt-1 block text-sm text-muted italic">{h.note}</span>}
                </button>
                <button aria-label="Delete highlight" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted hover:bg-surface" onClick={() => void deleteHighlight(h.id)}>
                  <Trash2 size={18} />
                </button>
              </div>
              {editing === h.id ? (
                <div className="mt-2 flex gap-2 pl-5">
                  <input
                    value={note}
                    autoFocus
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Add a note"
                    aria-label="Note"
                    className="h-10 flex-1 rounded-full bg-surface px-4 text-sm outline-none focus:ring-2 focus:ring-primary"
                  />
                  <button
                    className="h-10 rounded-full bg-primary px-4 text-sm font-semibold text-on-primary"
                    onClick={() => {
                      void updateHighlight(h.id, { note })
                      setEditing(null)
                    }}
                  >
                    Save
                  </button>
                </div>
              ) : (
                <div className="mt-1 flex items-center gap-1 pl-5">
                  {HIGHLIGHT_COLORS.map((c) => (
                    <button
                      key={c.color}
                      aria-label={`Color ${c.color}`}
                      onClick={() => void updateHighlight(h.id, { color: c.color })}
                      className={`grid h-8 w-8 place-items-center rounded-full ${h.color === c.color ? 'ring-2 ring-fg/40' : ''}`}
                    >
                      <span className="h-4 w-4 rounded-full" style={{ background: c.css }} />
                    </button>
                  ))}
                  <button
                    className="ml-1 h-8 rounded-full px-3 text-sm text-primary hover:bg-surface"
                    onClick={() => {
                      setNote(h.note)
                      setEditing(h.id)
                    }}
                  >
                    {h.note ? 'Edit note' : 'Add note'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-8 text-center text-muted">No highlights yet. Select text (long-press on a phone) to highlight it.</p>
      )}
    </Sheet>
  )
}
