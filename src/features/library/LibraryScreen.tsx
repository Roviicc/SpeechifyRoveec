import { useCallback, useEffect, useMemo, useState } from 'react'
import { CloudDownload, MoreHorizontal, RefreshCw, Search, X } from 'lucide-react'
import { navigate } from '../../app/router'
import type { BookRow, ProgressRow } from '../../data/db'
import { db } from '../../data/db'
import { allProgress, deleteBook, listBooks, onDataChange, renameBook } from '../../data/repo'
import { IconButton, Thumb } from '../../ui/controls'
import { Sheet } from '../../ui/Sheet'
import { session } from '../../app/session'
import { syncNow, syncSoon, useSync, drive } from '../../sync/syncService'
import type { SyncBook } from '../../sync/merge'
import { useImporter } from '../import/ImportSheet'

export function relativeDay(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((start(today) - start(d)) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

export function LibraryScreen({ onImport }: { onImport: () => void }) {
  const [books, setBooks] = useState<BookRow[] | null>(null)
  const [progress, setProgress] = useState<Record<string, ProgressRow>>({})
  const [cloud, setCloud] = useState<SyncBook[]>([])
  const [searching, setSearching] = useState(false)
  const [q, setQ] = useState('')
  const [menu, setMenu] = useState<BookRow | null>(null)
  const [renaming, setRenaming] = useState<BookRow | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<BookRow | null>(null)
  const [title, setTitle] = useState('')
  const sync = useSync()
  const importer = useImporter()

  const load = useCallback(async () => {
    const list = await listBooks()
    setBooks(list)
    setProgress(Object.fromEntries((await allProgress()).map((p) => [p.bookId, p])))
    const last = (await db.settings.get('lastSyncDoc'))?.value as { books: Record<string, SyncBook> } | undefined
    const local = new Set(list.map((b) => b.id))
    setCloud(Object.values(last?.books ?? {}).filter((b) => !b.deleted && b.driveFileId && !local.has(b.id)))
  }, [])

  useEffect(() => {
    void load()
    return onDataChange(() => void load())
  }, [load])

  const shown = useMemo(() => {
    const query = q.trim().toLowerCase()
    return (books ?? []).filter((b) => !query || b.title.toLowerCase().includes(query) || b.author?.toLowerCase().includes(query))
  }, [books, q])

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-6" data-testid="library">
      <header className="safe-top sticky top-0 z-10 flex h-16 items-center gap-2 bg-bg">
        {searching ? (
          <>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search your library"
              aria-label="Search your library"
              className="h-11 flex-1 rounded-full bg-surface px-5 outline-none focus:ring-2 focus:ring-primary"
              data-testid="library-search"
            />
            <IconButton
              label="Close search"
              onClick={() => {
                setSearching(false)
                setQ('')
              }}
            >
              <X size={22} />
            </IconButton>
          </>
        ) : (
          <>
            <h1 className="flex-1 text-[28px] font-bold tracking-tight">Library</h1>
            <IconButton label="Search" onClick={() => setSearching(true)} data-testid="library-search-button">
              <Search size={22} />
            </IconButton>
          </>
        )}
      </header>

      {sync.status === 'signin' && (
        <button
          onClick={() => void syncNow(true)}
          className="mb-3 flex w-full items-center gap-3 rounded-[16px] bg-primary-soft px-4 py-3 text-left text-sm"
          data-testid="sync-reconnect"
        >
          <RefreshCw size={18} className="text-primary" />
          <span className="flex-1">Sync is paused. Tap to reconnect Google Drive.</span>
        </button>
      )}

      {books && books.length === 0 && cloud.length === 0 && (
        <div className="flex flex-col items-center gap-4 py-24 text-center" data-testid="library-empty">
          <div className="grid h-20 w-20 place-items-center rounded-full bg-primary-soft text-4xl">📖</div>
          <p className="text-lg font-semibold">Import your first book</p>
          <p className="max-w-xs text-muted">Add an EPUB or a text-based PDF and Lumen will read it aloud.</p>
          <button className="h-12 rounded-full bg-primary px-6 font-semibold text-on-primary" onClick={onImport}>
            Import a book
          </button>
        </div>
      )}

      <ul>
        {shown.map((b) => {
          const p = progress[b.id]
          return (
            <li key={b.id} className="flex items-center gap-3 rounded-[16px] hover:bg-surface" data-testid="book-row">
              <button
                className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-2 text-left"
                onClick={() => navigate({ name: 'reader', bookId: b.id })}
                data-testid="book-open"
              >
                <Thumb cover={b.cover} type={b.type} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-semibold" data-testid="book-title">
                    {b.title}
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-muted" data-testid="book-meta">
                    {Math.round((p?.percent ?? 0) * 100)}% • {relativeDay(b.lastOpenedAt)} • {b.type}
                  </span>
                </span>
              </button>
              <IconButton label={`Options for ${b.title}`} onClick={() => setMenu(b)} data-testid="book-menu" className="mr-1 text-muted">
                <MoreHorizontal size={22} />
              </IconButton>
            </li>
          )
        })}
      </ul>

      {cloud.length > 0 && !q && (
        <>
          <h2 className="mt-6 mb-1 px-2 text-sm font-semibold text-muted">On your other devices</h2>
          <ul>
            {cloud.map((b) => (
              <li key={b.id} className="flex items-center gap-3 rounded-[16px] hover:bg-surface">
                <button
                  className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-2 text-left disabled:opacity-60"
                  disabled={!!importer.busy}
                  onClick={async () => {
                    const id = await importer.run([{ name: b.title, source: 'drive', driveFileId: b.driveFileId, get: () => drive.download(b.driveFileId!) }])
                    if (id) navigate({ name: 'reader', bookId: id })
                  }}
                >
                  <Thumb cover={b.cover} type={b.type} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-semibold">{b.title}</span>
                    <span className="mt-0.5 block text-sm text-muted">{importer.busy ?? 'In Google Drive • tap to download'}</span>
                  </span>
                  <CloudDownload size={20} className="mr-3 text-primary" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <Sheet open={!!menu} onClose={() => setMenu(null)} title={menu?.title} testId="book-menu-sheet">
        <button
          className="flex min-h-12 w-full items-center rounded-xl px-3 text-left text-[16px] hover:bg-surface"
          data-testid="book-rename"
          onClick={() => {
            setTitle(menu!.title)
            setRenaming(menu)
            setMenu(null)
          }}
        >
          Rename
        </button>
        <button
          className="flex min-h-12 w-full items-center rounded-xl px-3 text-left text-[16px] text-red-600 hover:bg-surface"
          data-testid="book-delete"
          onClick={() => {
            setConfirmDelete(menu)
            setMenu(null)
          }}
        >
          Delete
        </button>
      </Sheet>

      <Sheet open={!!renaming} onClose={() => setRenaming(null)} title="Rename" testId="rename-sheet">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (renaming && title.trim()) void renameBook(renaming.id, title.trim()).then(() => syncSoon())
            setRenaming(null)
          }}
        >
          <input
            data-autofocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Title"
            data-testid="rename-input"
            className="h-12 w-full rounded-full bg-surface px-5 outline-none focus:ring-2 focus:ring-primary"
          />
          <button type="submit" className="mt-3 h-12 w-full rounded-full bg-primary font-semibold text-on-primary" data-testid="rename-save">
            Save
          </button>
        </form>
      </Sheet>

      <Sheet open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete book?" testId="delete-sheet">
        <p className="mb-4 text-muted">“{confirmDelete?.title}” will be removed from this device and your synced library. Bookmarks and highlights are kept.</p>
        <button
          className="h-12 w-full rounded-full bg-red-600 font-semibold text-white"
          data-testid="delete-confirm"
          onClick={() => {
            const b = confirmDelete!
            if (session().book?.id === b.id) session().close()
            void deleteBook(b.id).then(() => syncSoon())
            setConfirmDelete(null)
          }}
        >
          Delete
        </button>
      </Sheet>
    </div>
  )
}
