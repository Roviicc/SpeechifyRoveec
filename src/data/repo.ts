import { db, type BookRow, type BookmarkRow, type HighlightRow, type Locator, type ProgressRow } from './db'
import { uid } from './util'
import type { BookDoc } from '@/engine/book/types'
import { DOC_VERSION } from '@/engine/book/types'

type Listener = () => void
const listeners = new Set<Listener>()
/** Lightweight change notification so screens and sync can react to local writes. */
export function onDataChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export function notifyChange() {
  listeners.forEach((fn) => fn())
}

// ---------- books ----------
export async function listBooks(): Promise<BookRow[]> {
  return db.books.orderBy('lastOpenedAt').reverse().toArray()
}

export async function getBook(id: string) {
  return db.books.get(id)
}

export async function saveImportedBook(row: BookRow, file: Blob, doc: BookDoc) {
  await db.transaction('rw', db.books, db.files, db.content, async () => {
    const existing = await db.books.get(row.id)
    await db.books.put(existing ? { ...existing, ...row, addedAt: existing.addedAt } : row)
    await db.files.put({ bookId: row.id, blob: file })
    await db.content.put({ bookId: row.id, version: DOC_VERSION, doc })
  })
  notifyChange()
}

export async function getContent(bookId: string): Promise<BookDoc | null> {
  const row = await db.content.get(bookId)
  return row && row.version === DOC_VERSION ? row.doc : null
}

export async function getFile(bookId: string) {
  return (await db.files.get(bookId))?.blob ?? null
}

export async function renameBook(id: string, title: string) {
  await db.books.update(id, { title, updatedAt: Date.now() })
  notifyChange()
}

export async function touchBook(id: string) {
  await db.books.update(id, { lastOpenedAt: Date.now() })
}

export async function deleteBook(id: string) {
  await db.transaction('rw', [db.books, db.files, db.content, db.audio], async () => {
    await db.books.delete(id)
    await db.files.delete(id)
    await db.content.delete(id)
    await db.audio.where('bookId').equals(id).delete()
  })
  await recordDeletedBook(id)
  notifyChange()
}

/** Tombstones for deleted books, so other devices drop them from the synced library too. */
export async function recordDeletedBook(id: string) {
  const row = await db.settings.get('deletedBooks')
  const map = (row?.value as Record<string, number> | undefined) ?? {}
  map[id] = Date.now()
  await db.settings.put({ key: 'deletedBooks', value: map, updatedAt: Date.now() })
}


// ---------- progress ----------
export async function getProgress(bookId: string) {
  return db.progress.get(bookId)
}

export async function allProgress() {
  return db.progress.toArray()
}

export async function saveProgress(p: Omit<ProgressRow, 'updatedAt'> & { updatedAt?: number }) {
  await db.progress.put({ ...p, updatedAt: p.updatedAt ?? Date.now() })
}

// ---------- bookmarks ----------
export async function listBookmarks(bookId: string): Promise<BookmarkRow[]> {
  return (await db.bookmarks.where('bookId').equals(bookId).toArray())
    .filter((b) => !b.deleted)
    .sort((a, b) => a.locator.block - b.locator.block || a.locator.offset - b.locator.offset)
}

export async function addBookmark(bookId: string, locator: Locator, label: string) {
  const now = Date.now()
  const row: BookmarkRow = { id: uid(), bookId, locator, label, createdAt: now, updatedAt: now }
  await db.bookmarks.put(row)
  notifyChange()
  return row
}

export async function deleteBookmark(id: string) {
  await db.bookmarks.update(id, { deleted: true, updatedAt: Date.now() })
  notifyChange()
}

// ---------- highlights ----------
export async function listHighlights(bookId: string): Promise<HighlightRow[]> {
  return (await db.highlights.where('bookId').equals(bookId).toArray())
    .filter((h) => !h.deleted)
    .sort((a, b) => a.start.block - b.start.block || a.start.offset - b.start.offset)
}

export async function addHighlight(h: Omit<HighlightRow, 'id' | 'createdAt' | 'updatedAt'>) {
  const now = Date.now()
  const row: HighlightRow = { ...h, id: uid(), createdAt: now, updatedAt: now }
  await db.highlights.put(row)
  notifyChange()
  return row
}

export async function updateHighlight(id: string, patch: Partial<Pick<HighlightRow, 'color' | 'note'>>) {
  await db.highlights.update(id, { ...patch, updatedAt: Date.now() })
  notifyChange()
}

export async function deleteHighlight(id: string) {
  await db.highlights.update(id, { deleted: true, updatedAt: Date.now() })
  notifyChange()
}
