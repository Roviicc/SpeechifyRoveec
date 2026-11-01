import type { LumenDB } from '@/data/db'
import type { Settings } from '@/state/settings'
import type { DriveClient } from '@/sync/drive/client'
import { emptySyncDoc, mergeSyncDocs, parseSyncDoc, sameSyncContent, type SyncDoc } from './merge'

export const SYNC_FILE = 'sync.json'

export interface SettingsBridge {
  get(): Settings
  replace(s: Settings): void
}

const SYNCED_SETTINGS: Array<keyof Settings> = [
  'theme', 'fontSize', 'fontFamily', 'lineHeight', 'margin', 'speed', 'highlightSentence', 'highlightWord', 'autoScroll', 'skip', 'dictionary',
]

/** Snapshot local data as a SyncDoc. */
export async function collectLocal(db: LumenDB, settings?: SettingsBridge): Promise<SyncDoc> {
  const doc = emptySyncDoc()
  for (const b of await db.books.toArray()) {
    doc.books[b.id] = { id: b.id, title: b.title, type: b.type, driveFileId: b.driveFileId, cover: b.cover, updatedAt: b.updatedAt }
  }
  const deleted = ((await db.settings.get('deletedBooks'))?.value as Record<string, number> | undefined) ?? {}
  for (const [id, at] of Object.entries(deleted)) {
    if (!doc.books[id] || doc.books[id].updatedAt < at) doc.books[id] = { id, title: '', type: 'pdf', updatedAt: at, deleted: true }
  }
  for (const p of await db.progress.toArray()) doc.progress[p.bookId] = p
  for (const b of await db.bookmarks.toArray()) doc.bookmarks[b.id] = b
  for (const h of await db.highlights.toArray()) doc.highlights[h.id] = h
  if (settings) {
    const s = settings.get()
    const value: Partial<Settings> = {}
    for (const k of SYNCED_SETTINGS) (value as Record<string, unknown>)[k] = s[k]
    doc.settings = { value, updatedAt: s.updatedAt }
  }
  doc.updatedAt = Date.now()
  return doc
}

/** Write anything in `merged` that is newer than local data. Returns ids of books whose progress changed. */
export async function applyToLocal(db: LumenDB, merged: SyncDoc, settings?: SettingsBridge): Promise<string[]> {
  const changedProgress: string[] = []
  await db.transaction('rw', [db.books, db.files, db.content, db.audio, db.progress, db.bookmarks, db.highlights, db.settings], async () => {
    for (const b of Object.values(merged.books)) {
      const local = await db.books.get(b.id)
      if (!local) continue
      if (b.deleted && b.updatedAt > local.updatedAt && b.updatedAt > local.addedAt) {
        await db.books.delete(b.id)
        await db.files.delete(b.id)
        await db.content.delete(b.id)
        await db.audio.where('bookId').equals(b.id).delete()
      } else if (!b.deleted && b.updatedAt > local.updatedAt) {
        await db.books.update(b.id, { title: b.title, updatedAt: b.updatedAt, driveFileId: local.driveFileId ?? b.driveFileId })
      }
    }
    const deletedMap = ((await db.settings.get('deletedBooks'))?.value as Record<string, number> | undefined) ?? {}
    let deletedChanged = false
    for (const b of Object.values(merged.books)) {
      if (b.deleted && (deletedMap[b.id] ?? 0) < b.updatedAt) {
        deletedMap[b.id] = b.updatedAt
        deletedChanged = true
      }
    }
    if (deletedChanged) await db.settings.put({ key: 'deletedBooks', value: deletedMap, updatedAt: Date.now() })
    for (const p of Object.values(merged.progress)) {
      const local = await db.progress.get(p.bookId)
      if (!local || p.updatedAt > local.updatedAt) {
        await db.progress.put(p)
        changedProgress.push(p.bookId)
      }
    }
    for (const b of Object.values(merged.bookmarks)) {
      const local = await db.bookmarks.get(b.id)
      if (!local || b.updatedAt > local.updatedAt) await db.bookmarks.put(b)
    }
    for (const h of Object.values(merged.highlights)) {
      const local = await db.highlights.get(h.id)
      if (!local || h.updatedAt > local.updatedAt) await db.highlights.put(h)
    }
    await db.settings.put({ key: 'lastSyncDoc', value: { books: merged.books }, updatedAt: Date.now() })
  })
  if (settings && merged.settings) {
    const cur = settings.get()
    if (merged.settings.updatedAt > cur.updatedAt) settings.replace({ ...cur, ...merged.settings.value, updatedAt: merged.settings.updatedAt })
  }
  return changedProgress
}

/** One full round: pull sync.json, merge with local, write both sides. */
export async function syncOnce(db: LumenDB, drive: DriveClient, settings?: SettingsBridge): Promise<{ changedProgress: string[]; uploaded: boolean }> {
  const local = await collectLocal(db, settings)
  const file = await drive.findAppFile(SYNC_FILE)
  const remote = file ? parseSyncDoc(await drive.readAppFile(file.id)) : emptySyncDoc()
  const merged = mergeSyncDocs(local, remote)
  const changedProgress = await applyToLocal(db, merged, settings)
  let uploaded = false
  if (!file) {
    await drive.createAppFile(SYNC_FILE, merged)
    uploaded = true
  } else if (!sameSyncContent(merged, remote)) {
    await drive.updateAppFile(file.id, merged)
    uploaded = true
  }
  return { changedProgress, uploaded }
}
