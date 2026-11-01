import { beforeEach, describe, expect, it } from 'vitest'
import { LumenDB, type BookRow } from '@/data/db'
import { DexieAudioStore } from '@/data/audioCache'
import { FakeDrive } from '@/sync/drive/fakeDrive'
import { syncOnce, SYNC_FILE, type SettingsBridge } from '@/sync/syncCore'
import { mergeSyncDocs, emptySyncDoc } from '@/sync/merge'
import { DEFAULT_SETTINGS, settingsSnapshot, useSettings, type Settings } from '@/state/settings'

let n = 0
function device() {
  const db = new LumenDB(`test-${++n}`)
  let settings: Settings = { ...DEFAULT_SETTINGS }
  const bridge: SettingsBridge = { get: () => settings, replace: (s) => (settings = s) }
  return { db, bridge, settings: () => settings, setSettings: (p: Partial<Settings>, at: number) => (settings = { ...settings, ...p, updatedAt: at }) }
}

const book = (id: string, t = 1000): BookRow => ({
  id,
  title: 'Book ' + id,
  type: 'epub',
  source: 'drive',
  driveFileId: 'drv-' + id,
  size: 10,
  addedAt: t,
  lastOpenedAt: t,
  updatedAt: t,
})
const loc = (block: number) => ({ section: 0, block, offset: 0 })

describe('merge', () => {
  it('picks the newest record and keeps tombstones', () => {
    const a = emptySyncDoc()
    const b = emptySyncDoc()
    a.bookmarks.x = { id: 'x', bookId: 'b', locator: loc(1), label: 'A', createdAt: 1, updatedAt: 5 }
    b.bookmarks.x = { id: 'x', bookId: 'b', locator: loc(1), label: 'A', createdAt: 1, updatedAt: 9, deleted: true }
    b.bookmarks.y = { id: 'y', bookId: 'b', locator: loc(2), label: 'B', createdAt: 1, updatedAt: 2 }
    const m = mergeSyncDocs(a, b)
    expect(m.bookmarks.x.deleted).toBe(true)
    expect(Object.keys(m.bookmarks).sort()).toEqual(['x', 'y'])
  })
})

describe('sync between two devices', () => {
  let drive: FakeDrive
  beforeEach(() => {
    drive = new FakeDrive()
  })

  it('progress made on the laptop shows up on the phone', async () => {
    const laptop = device()
    const phone = device()
    await laptop.db.books.put(book('b1'))
    await phone.db.books.put(book('b1'))
    await laptop.db.progress.put({ bookId: 'b1', sentence: 42, locator: loc(7), percent: 0.3, sectionTitle: 'Chapter 3', updatedAt: 5000 })
    await phone.db.progress.put({ bookId: 'b1', sentence: 3, locator: loc(1), percent: 0.02, sectionTitle: 'Chapter 1', updatedAt: 4000 })

    await syncOnce(laptop.db, drive)
    expect(await drive.findAppFile(SYNC_FILE)).not.toBeNull()
    const res = await syncOnce(phone.db, drive)
    expect(res.changedProgress).toEqual(['b1'])
    const p = await phone.db.progress.get('b1')
    expect(p?.sentence).toBe(42)
    expect(p?.sectionTitle).toBe('Chapter 3')
  })

  it('deleting a bookmark on one device deletes it on the other', async () => {
    const a = device()
    const b = device()
    await a.db.bookmarks.put({ id: 'bm', bookId: 'b1', locator: loc(3), label: 'x', createdAt: 100, updatedAt: 100 })
    await syncOnce(a.db, drive)
    await syncOnce(b.db, drive)
    expect((await b.db.bookmarks.get('bm'))?.deleted).toBeFalsy()
    await b.db.bookmarks.update('bm', { deleted: true, updatedAt: 200 })
    await syncOnce(b.db, drive)
    await syncOnce(a.db, drive)
    expect((await a.db.bookmarks.get('bm'))?.deleted).toBe(true)
  })

  it('highlights edited on both devices merge per record, newest wins', async () => {
    const a = device()
    const b = device()
    const h = { bookId: 'b1', start: loc(1), end: loc(1), text: 't', color: 'yellow' as const, note: '', createdAt: 1 }
    await a.db.highlights.put({ ...h, id: 'h1', updatedAt: 10 })
    await b.db.highlights.put({ ...h, id: 'h2', updatedAt: 11 })
    await syncOnce(a.db, drive)
    await syncOnce(b.db, drive)
    await a.db.highlights.update('h1', { note: 'from a', updatedAt: 20 })
    await b.db.highlights.update('h1', { color: 'pink', updatedAt: 30 })
    await syncOnce(a.db, drive)
    await syncOnce(b.db, drive)
    await syncOnce(a.db, drive)
    for (const d of [a, b]) {
      const all = await d.db.highlights.toArray()
      expect(all.map((x) => x.id).sort()).toEqual(['h1', 'h2'])
      expect((await d.db.highlights.get('h1'))?.color).toBe('pink')
    }
  })

  it('syncs settings last-write-wins and deleted books', async () => {
    const a = device()
    const b = device()
    await a.db.books.put(book('b1'))
    await b.db.books.put(book('b1'))
    a.setSettings({ speed: 2, dictionary: [{ word: 'SQL', say: 'sequel' }] }, 5000)
    b.setSettings({ speed: 1.2 }, 3000)
    await syncOnce(a.db, drive, a.bridge)
    await syncOnce(b.db, drive, b.bridge)
    expect(b.settings().speed).toBe(2)
    expect(b.settings().dictionary).toEqual([{ word: 'SQL', say: 'sequel' }])

    await a.db.books.delete('b1')
    await a.db.settings.put({ key: 'deletedBooks', value: { b1: 9000 }, updatedAt: 9000 })
    await syncOnce(a.db, drive, a.bridge)
    await syncOnce(b.db, drive, b.bridge)
    expect(await b.db.books.get('b1')).toBeUndefined()
  })

  it('does not rewrite the Drive file when nothing changed', async () => {
    const a = device()
    await a.db.bookmarks.put({ id: 'bm', bookId: 'b1', locator: loc(3), label: 'x', createdAt: 1, updatedAt: 1 })
    await syncOnce(a.db, drive)
    const writes = drive.writes
    await syncOnce(a.db, drive)
    expect(drive.writes).toBe(writes)
  })

  it('a device-local setting change does not make stale synced settings win', async () => {
    const a = device()
    const store = useSettings.getState()
    store.replace({ ...DEFAULT_SETTINGS, theme: 'light', updatedAt: 50 })
    const bridge: SettingsBridge = { get: settingsSnapshot, replace: (s) => useSettings.getState().replace(s) }
    // another device chose dark at t=100
    const other = device()
    other.setSettings({ theme: 'dark' }, 100)
    await syncOnce(other.db, drive, other.bridge)
    // this device only flips its (unsynced) PDF view mode
    useSettings.getState().set({ pdfMode: 'text' })
    await syncOnce(a.db, drive, bridge)
    expect(settingsSnapshot().theme).toBe('dark')
    expect(settingsSnapshot().pdfMode).toBe('text')
  })
})

describe('audio cache', () => {
  it('stores by book + sentence, checks text, evicts LRU over the cap', async () => {
    const db = new LumenDB(`audio-${++n}`)
    const store = new DexieAudioStore(db, 2500)
    const blob = (size: number) => new Blob([new Uint8Array(size)])
    await store.put('b', 0, 'hello', blob(1000), 1)
    expect(await store.get('b', 0, 'hello')).not.toBeNull()
    expect(await store.get('b', 0, 'changed text')).toBeNull()
    // audio made by another voice is never reused
    store.voice = () => 'piper'
    expect(await store.get('b', 0, 'hello')).toBeNull()
    store.voice = () => ''
    await store.put('b', 1, 'two', blob(1000), 1)
    await new Promise((r) => setTimeout(r, 5))
    await store.put('b', 2, 'three', blob(1000), 1)
    await store.evict()
    expect(await store.totalSize()).toBeLessThanOrEqual(2500)
    expect(await store.get('b', 2, 'three')).not.toBeNull()
  })
})
