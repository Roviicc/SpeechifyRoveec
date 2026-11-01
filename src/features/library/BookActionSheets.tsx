import { useState } from 'react'
import type { BookRow } from '../../data/db'
import { deleteBook, renameBook } from '../../data/repo'
import { Sheet } from '../../ui/Sheet'
import { session } from '../../app/session'
import { syncSoon } from '../../sync/syncService'

/** The options sheet of a library row (Rename, Delete) and the rename / delete-confirmation sheets it opens. */
export function BookActionSheets({ menuFor, onCloseMenu }: { menuFor: BookRow | null; onCloseMenu: () => void }) {
  const [renaming, setRenaming] = useState<BookRow | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<BookRow | null>(null)
  const [title, setTitle] = useState('')

  return (
    <>
      <Sheet open={!!menuFor} onClose={onCloseMenu} title={menuFor?.title} testId="book-menu-sheet">
        <button
          className="flex min-h-12 w-full items-center rounded-xl px-3 text-left text-[16px] hover:bg-surface"
          data-testid="book-rename"
          onClick={() => {
            if (!menuFor) return
            setTitle(menuFor.title)
            setRenaming(menuFor)
            onCloseMenu()
          }}
        >
          Rename
        </button>
        <button
          className="flex min-h-12 w-full items-center rounded-xl px-3 text-left text-[16px] text-red-600 hover:bg-surface"
          data-testid="book-delete"
          onClick={() => {
            setConfirmDelete(menuFor)
            onCloseMenu()
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
            if (!confirmDelete) return
            if (session().book?.id === confirmDelete.id) session().close()
            void deleteBook(confirmDelete.id).then(() => syncSoon())
            setConfirmDelete(null)
          }}
        >
          Delete
        </button>
      </Sheet>
    </>
  )
}
