import type { LumenDB } from '@/data/db'
import type { DriveClient } from '@/sync/drive/client'
import type { SyncBook } from '@/sync/merge'

/** appProperties tag of a book file copied into the appDataFolder. */
export const BOOK_COPY_KIND = 'book'

export interface BookCopyResult {
  uploaded: string[]
  removed: string[]
}

const CLEANED_KEY = 'bookCopiesCleaned'

/**
 * Books imported from a local file have no Google Drive file another device could download, so their file is copied
 * into the hidden appDataFolder (tagged `{kind: 'book', bookId}`) and its id kept as `driveCopyId`, which travels in
 * sync.json. Books whose synced entry is a tombstone have their copy removed. Runs after a sync; one listing per pass,
 * skipped when there is nothing to upload or clean.
 */
export async function syncBookCopies(db: LumenDB, drive: DriveClient): Promise<BookCopyResult> {
  const result: BookCopyResult = { uploaded: [], removed: [] }
  const toUpload = (await db.books.toArray()).filter((b) => !b.driveFileId && !b.driveCopyId)
  const synced = ((await db.settings.get('lastSyncDoc'))?.value as { books?: Record<string, SyncBook> } | undefined)?.books ?? {}
  const cleaned = ((await db.settings.get(CLEANED_KEY))?.value as Record<string, number> | undefined) ?? {}
  const local = new Set((await db.books.toCollection().primaryKeys()) as string[])
  const toClean = Object.values(synced).filter((b) => b.deleted && !local.has(b.id) && (cleaned[b.id] ?? 0) < b.updatedAt)
  if (!toUpload.length && !toClean.length) return result

  const copies = await drive.listAppFiles({ kind: BOOK_COPY_KIND })
  const byBook = new Map<string, string[]>()
  for (const f of copies) {
    const id = f.appProperties.bookId
    if (id) byBook.set(id, [...(byBook.get(id) ?? []), f.id])
  }

  for (const b of toClean) {
    for (const fileId of byBook.get(b.id) ?? []) await drive.deleteAppFile(fileId)
    if (byBook.has(b.id)) result.removed.push(b.id)
    cleaned[b.id] = b.updatedAt
  }
  if (toClean.length) await db.settings.put({ key: CLEANED_KEY, value: cleaned, updatedAt: Date.now() })

  for (const b of toUpload) {
    let copyId = byBook.get(b.id)?.[0]
    if (!copyId) {
      const file = await db.files.get(b.id)
      if (!file) continue
      const ext = b.type === 'pdf' ? 'pdf' : 'epub'
      copyId = (await drive.uploadAppBlob({ name: `${b.id}.${ext}`, blob: file.blob, appProperties: { kind: BOOK_COPY_KIND, bookId: b.id } })).id
      result.uploaded.push(b.id)
    }
    // the row may have been deleted meanwhile; update() is then a no-op
    await db.books.update(b.id, { driveCopyId: copyId })
  }
  return result
}
