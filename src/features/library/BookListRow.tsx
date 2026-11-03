import { MoreHorizontal } from 'lucide-react'
import { navigate } from '@/app/router'
import type { BookRow, ProgressRow } from '@/data/db'
import { IconButton, Thumb } from '@/ui/controls'
import { usePrepare } from '@/state/prepare'

function relativeDay(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((start(today) - start(d)) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

/** A library row: thumbnail, title, "12% • Today • pdf" and the "•••" options button. */
/** " • Preparing 34%" / " • Audio queued" while this book's audio is being generated ahead. */
function usePrepareNote(bookId: string): string {
  return usePrepare((s) => {
    if (s.current?.job.bookId === bookId) return ` • Preparing ${s.current.total ? Math.round((s.current.done / s.current.total) * 100) : 0}%`
    return s.queue.some((j) => j.bookId === bookId) ? ' • Audio queued' : ''
  })
}

export function BookListRow({ book, progress, onMenu }: { book: BookRow; progress: ProgressRow | undefined; onMenu: () => void }) {
  const prepareNote = usePrepareNote(book.id)
  return (
    <li className="flex items-center gap-3 rounded-[16px] hover:bg-surface" data-testid="book-row">
      <button className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-2 text-left" onClick={() => navigate({ name: 'reader', bookId: book.id })} data-testid="book-open">
        <Thumb cover={book.cover} type={book.type} size={44} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-semibold" data-testid="book-title">
            {book.title}
          </span>
          <span className="mt-0.5 block truncate text-sm text-muted" data-testid="book-meta">
            {Math.round((progress?.percent ?? 0) * 100)}% • {relativeDay(book.lastOpenedAt)} • {book.type}
            {prepareNote}
          </span>
        </span>
      </button>
      <IconButton label={`Options for ${book.title}`} onClick={onMenu} data-testid="book-menu" className="mr-1 text-muted">
        <MoreHorizontal size={22} />
      </IconButton>
    </li>
  )
}
