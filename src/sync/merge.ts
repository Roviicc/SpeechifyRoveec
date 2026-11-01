import type { BookmarkRow, HighlightRow, ProgressRow } from '@/data/db'
import type { Settings } from '@/state/settings'

export interface SyncBook {
  id: string
  title: string
  type: 'epub' | 'pdf'
  driveFileId?: string
  cover?: string
  updatedAt: number
  deleted?: boolean
}

/** The single JSON file kept in the Drive appDataFolder. */
export interface SyncDoc {
  version: 1
  updatedAt: number
  books: Record<string, SyncBook>
  progress: Record<string, ProgressRow>
  bookmarks: Record<string, BookmarkRow>
  highlights: Record<string, HighlightRow>
  settings?: { value: Partial<Settings>; updatedAt: number }
}

export function emptySyncDoc(): SyncDoc {
  return { version: 1, updatedAt: 0, books: {}, progress: {}, bookmarks: {}, highlights: {} }
}

function mergeMap<T extends { updatedAt: number }>(a: Record<string, T>, b: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = { ...a }
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k]
    if (!cur || v.updatedAt > cur.updatedAt) out[k] = v
  }
  return out
}

/** Per-record last-write-wins merge on updatedAt; deletes are tombstones so they win too. */
export function mergeSyncDocs(a: SyncDoc, b: SyncDoc): SyncDoc {
  const settings =
    a.settings && b.settings ? (b.settings.updatedAt > a.settings.updatedAt ? b.settings : a.settings) : (a.settings ?? b.settings)
  return {
    version: 1,
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
    books: mergeMap(a.books, b.books),
    progress: mergeMap(a.progress, b.progress),
    bookmarks: mergeMap(a.bookmarks, b.bookmarks),
    highlights: mergeMap(a.highlights, b.highlights),
    settings,
  }
}

/** Normalise JSON that came from Drive (older/partial files). */
export function parseSyncDoc(json: unknown): SyncDoc {
  const d = (json && typeof json === 'object' ? json : {}) as Partial<SyncDoc>
  return {
    version: 1,
    updatedAt: Number(d.updatedAt) || 0,
    books: d.books ?? {},
    progress: d.progress ?? {},
    bookmarks: d.bookmarks ?? {},
    highlights: d.highlights ?? {},
    settings: d.settings,
  }
}

/** True if `b` has anything newer than `a` (so the remote file needs an update). */
export function sameSyncContent(a: SyncDoc, b: SyncDoc): boolean {
  const strip = (d: SyncDoc) => JSON.stringify({ ...d, updatedAt: 0 })
  return strip(a) === strip(b)
}
