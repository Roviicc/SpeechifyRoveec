import { beforeEach, describe, expect, it } from 'vitest'
import { LumenDB, type BookRow } from '@/data/db'
import { FakeDrive } from '@/sync/drive/fakeDrive'
import { syncOnce } from '@/sync/syncCore'
import { syncBookCopies } from '@/sync/bookCopies'
import type { SyncBook } from '@/sync/merge'

let n = 0
const device = () => new LumenDB(`copies-${++n}`)

const localBook = (id: string, t = 1000): BookRow => ({
  id,
  title: 'Book ' + id,
  type: 'pdf',
  source: 'local',
  size: 4,
  addedAt: t,
  lastOpenedAt: t,
  updatedAt: t,
})

async function addLocal(db: LumenDB, id: string, bytes = 'data') {
  await db.books.put(localBook(id))
  await db.files.put({ bookId: id, blob: new Blob([bytes], { type: 'application/pdf' }) })
}

async function syncedBooks(db: LumenDB) {
  return ((await db.settings.get('lastSyncDoc'))?.value as { books: Record<string, SyncBook> }).books
}

/** what the app does: sync, copy books, and sync again when a copy was made */
async function fullSync(db: LumenDB, drive: FakeDrive) {
  await syncOnce(db, drive)
  const r = await syncBookCopies(db, drive)
  if (r.uploaded.length) await syncOnce(db, drive)
  return r
}

describe('book files imported from a computer reach other devices', () => {
  let drive: FakeDrive
  beforeEach(() => {
    drive = new FakeDrive()
  })

  it('copies the file to Drive and lists it for download on the phone', async () => {
    const laptop = device()
    const phone = device()
    await addLocal(laptop, 'b1', 'pdf bytes')

    const r = await fullSync(laptop, drive)
    expect(r.uploaded).toEqual(['b1'])
    const copyId = (await laptop.books.get('b1'))?.driveCopyId
    expect(copyId).toBeTruthy()
    expect(drive.blobs.get(copyId!)?.appProperties).toEqual({ kind: 'book', bookId: 'b1' })

    await fullSync(phone, drive)
    const listed = (await syncedBooks(phone)).b1
    expect(listed.driveCopyId).toBe(copyId)
    // the phone downloads exactly the file the laptop stored
    expect(await drive.download(listed.driveCopyId!)).toBe(drive.blobs.get(copyId!)!.blob)
  })

  it('uploads once: a device that already has the book picks up the existing copy', async () => {
    const laptop = device()
    const phone = device()
    await addLocal(laptop, 'b1')
    await addLocal(phone, 'b1')
    await fullSync(laptop, drive)
    const r = await fullSync(phone, drive)
    expect(r.uploaded).toEqual([])
    expect(drive.uploads).toBe(1)
    expect((await phone.books.get('b1'))?.driveCopyId).toBe((await laptop.books.get('b1'))?.driveCopyId)
    // nothing left to do: no further Drive listing
    const before = drive.uploads
    expect(await fullSync(laptop, drive)).toEqual({ uploaded: [], removed: [] })
    expect(drive.uploads).toBe(before)
  })

  it('reuses a copy already in Drive when the synced id has not arrived yet', async () => {
    const laptop = device()
    const phone = device()
    await addLocal(laptop, 'b1')
    await addLocal(phone, 'b1')
    await syncOnce(laptop, drive)
    await syncBookCopies(laptop, drive) // uploaded, but sync.json not updated yet
    const r = await syncBookCopies(phone, drive)
    expect(r.uploaded).toEqual([])
    expect(drive.uploads).toBe(1)
  })

  it('books picked from Google Drive are not copied', async () => {
    const laptop = device()
    await laptop.books.put({ ...localBook('b1'), source: 'drive', driveFileId: 'drv-b1' })
    await laptop.files.put({ bookId: 'b1', blob: new Blob(['x']) })
    expect(await fullSync(laptop, drive)).toEqual({ uploaded: [], removed: [] })
    expect(drive.blobs.size).toBe(0)
  })

  it('deleting the book removes its copy from Drive', async () => {
    const laptop = device()
    const phone = device()
    await addLocal(laptop, 'b1')
    await fullSync(laptop, drive)
    await fullSync(phone, drive)
    expect(drive.blobs.size).toBe(1)

    await laptop.books.delete('b1')
    await laptop.files.delete('b1')
    await laptop.settings.put({ key: 'deletedBooks', value: { b1: 5000 }, updatedAt: 5000 })
    const r = await fullSync(laptop, drive)
    expect(r.removed).toEqual(['b1'])
    expect(drive.blobs.size).toBe(0)

    await fullSync(phone, drive)
    expect((await syncedBooks(phone)).b1.deleted).toBe(true)
  })

  it('a device that synced before the copy existed learns its id without a newer edit', async () => {
    const laptop = device()
    const phone = device()
    await addLocal(laptop, 'b1')
    await addLocal(phone, 'b1')
    await syncOnce(laptop, drive)
    await syncOnce(phone, drive)
    await fullSync(laptop, drive)
    await syncOnce(phone, drive)
    expect((await phone.books.get('b1'))?.driveCopyId).toBe((await laptop.books.get('b1'))?.driveCopyId)
    // and the phone's sync doesn't drop the id from Drive
    await syncOnce(laptop, drive)
    expect((await syncedBooks(laptop)).b1.driveCopyId).toBeTruthy()
  })
})
