import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search, X } from 'lucide-react'
import { navigate } from '@/app/router'
import type { BookRow, ProgressRow } from '@/data/db'
import { db } from '@/data/db'
import { allProgress, listBooks, onDataChange } from '@/data/repo'
import { IconButton } from '@/ui/controls'
import { syncNow, useSync, drive } from '@/sync/syncService'
import type { SyncBook } from '@/sync/merge'
import { useImporter } from '@/features/library/import/ImportSheet'
import { BookListRow } from './BookListRow'
import { CloudBookRow } from './CloudBookRow'
import { BookActionSheets } from './BookActionSheets'

export function LibraryScreen({ onImport }: { onImport: () => void }) {
  const [books, setBooks] = useState<BookRow[] | null>(null)
  const [progress, setProgress] = useState<Record<string, ProgressRow>>({})
  const [cloud, setCloud] = useState<SyncBook[]>([])
  const [searching, setSearching] = useState(false)
  const [q, setQ] = useState('')
  const [menu, setMenu] = useState<BookRow | null>(null)
  const sync = useSync()
  const importer = useImporter()

  const load = useCallback(async () => {
    const list = await listBooks()
    setBooks(list)
    setProgress(Object.fromEntries((await allProgress()).map((p) => [p.bookId, p])))
    const last = (await db.settings.get('lastSyncDoc'))?.value as { books: Record<string, SyncBook> } | undefined
    const local = new Set(list.map((b) => b.id))
    setCloud(Object.values(last?.books ?? {}).filter((b) => !b.deleted && (b.driveFileId || b.driveCopyId) && !local.has(b.id)))
  }, [])

  useEffect(() => {
    void load()
    return onDataChange(() => void load())
  }, [load])

  const shown = useMemo(() => {
    const query = q.trim().toLowerCase()
    return (books ?? []).filter((b) => !query || b.title.toLowerCase().includes(query) || b.author?.toLowerCase().includes(query))
  }, [books, q])

  const download = async (b: SyncBook) => {
    // a book picked from the user's Drive is fetched from there; one imported from a file comes from the app's copy
    const fileId = b.driveFileId ?? b.driveCopyId!
    const id = await importer.run([
      { name: b.title, source: b.driveFileId ? 'drive' : 'local', driveFileId: b.driveFileId, driveCopyId: b.driveCopyId, get: () => drive.download(fileId) },
    ])
    if (id) navigate({ name: 'reader', bookId: id })
  }

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
        {shown.map((b) => (
          <BookListRow key={b.id} book={b} progress={progress[b.id]} onMenu={() => setMenu(b)} />
        ))}
      </ul>

      {cloud.length > 0 && !q && (
        <>
          <h2 className="mt-6 mb-1 px-2 text-sm font-semibold text-muted">On your other devices</h2>
          <ul>
            {cloud.map((b) => (
              <CloudBookRow key={b.id} book={b} busy={importer.busy} onDownload={() => void download(b)} />
            ))}
          </ul>
        </>
      )}

      <BookActionSheets menuFor={menu} onCloseMenu={() => setMenu(null)} />
    </div>
  )
}
