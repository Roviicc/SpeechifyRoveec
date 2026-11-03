// @vitest-environment node
// (Node's Blob survives fake-indexeddb's structured clone; jsdom's does not, and these tests check audio bytes)
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LumenDB } from '@/data/db'
import { DexieAudioStore, audioHash, textHash } from '@/data/audioCache'
import { FakeDrive } from '@/sync/drive/fakeDrive'
import { DriveHttpError, GoogleDriveClient, MULTIPART_LIMIT, UPLOAD_CHUNK } from '@/sync/drive/client'
import { AudioShare, type AudioShareDeps } from '@/sync/audio/audioShare'
import { decodePack, encodePack, packSig } from '@/sync/audio/pack'
import { packRanges } from '@/sync/audio/packRanges'
import { autoDownloadAllowed } from '@/sync/audio/network'
import { FakeTtsBackend } from '@/engine/voice/fakeBackend'
import { Player, type AudioLike } from '@/engine/voice/player/player'
import { buildBookIndex } from '@/engine/book/bookIndex'
import { DEFAULT_SKIP } from '@/engine/text/types'
import type { BookDoc } from '@/engine/book/types'
import type { PackRange } from '@/sync/audio/packRanges'

const identity = async (b: Blob) => b
const texts = ['Chapter one.', 'A first.', 'A second.', 'Chapter two.', 'B first.', 'B second.', 'B third.']
const ranges: PackRange[] = [
  { from: 0, to: 2 },
  { from: 3, to: 6 },
]
const audio = (n: number, type = 'audio/ogg; codecs=opus') => new Blob([new Uint8Array(n).fill(n % 251)], { type })

let dbn = 0
function device(drive: FakeDrive, opts: { voice?: string; deps?: Partial<AudioShareDeps> } = {}) {
  const db = new LumenDB(`share-${++dbn}`)
  const store = new DexieAudioStore(db, 10_000_000, identity)
  store.voice = () => opts.voice ?? 'kokoro'
  const marks: number[] = []
  const errors: string[] = []
  const share = new AudioShare({
    drive,
    store,
    enabled: () => true,
    book: async () => ({ texts, ranges }),
    onSentence: (_b, i) => marks.push(i),
    onError: (m) => errors.push(m),
    retryDelays: [1, 1, 1],
    ...opts.deps,
  })
  return { db, store, share, marks, errors }
}

/** Prepare sentences (as the Preparer does) with `voice`. */
async function prepare(store: DexieAudioStore, indexes: number[], voice = 'kokoro', size = 100) {
  for (const i of indexes) await store.putPrepared('book', i, texts[i], audio(size + i), 1 + i / 10, voice)
}

describe('audio packs', () => {
  it('encode/decode round trip keeps every entry and its bytes', async () => {
    const inputs = [2, 0, 1].map((i) => ({ index: i, hash: audioHash('kokoro', texts[i]), textHash: textHash(texts[i]), voice: 'kokoro', duration: 1.25 + i, blob: audio(50 + i * 7) }))
    const { blob, header, sig } = encodePack({ bookId: 'book', from: 0, to: 2 }, inputs)
    expect(header.entries.map((e) => e.index)).toEqual([0, 1, 2])
    expect(header.voice).toBe('kokoro')
    const back = await decodePack(blob)
    expect(back.header.bookId).toBe('book')
    expect(back.header.from).toBe(0)
    expect(back.header.to).toBe(2)
    expect(packSig(back.header.entries)).toBe(sig)
    for (const e of back.entries) {
      const src = inputs.find((x) => x.index === e.index)!
      expect(e.duration).toBe(src.duration)
      expect(e.hash).toBe(src.hash)
      expect(e.blob.type).toBe('audio/ogg; codecs=opus')
      expect(new Uint8Array(await e.blob.arrayBuffer())).toEqual(new Uint8Array(await src.blob.arrayBuffer()))
    }
  })

  it('rejects files that are not packs', async () => {
    await expect(decodePack(new Blob(['hello world']))).rejects.toThrow(/Not a Lumen audio pack/)
  })

  it('cuts a book into one range per top-level chapter', () => {
    const doc: BookDoc = {
      version: 1,
      type: 'epub',
      title: 'T',
      toc: [
        { title: 'One', section: 0, level: 0 },
        { title: 'One.1', section: 1, level: 1 },
        { title: 'Two', section: 2, level: 0 },
      ],
      sections: [
        { title: 'One', blocks: [{ text: 'Chapter one.', kind: 'h' }, { text: 'A first. A second.', kind: 'p' }] },
        { title: 'One.1', blocks: [{ text: 'Sub. More.', kind: 'p' }] },
        { title: 'Two', blocks: [{ text: 'Chapter two.', kind: 'h' }, { text: 'B first.', kind: 'p' }] },
      ],
    }
    const idx = buildBookIndex(doc, { skip: DEFAULT_SKIP, dictionary: [] })
    const r = packRanges(doc.toc, idx)
    expect(r).toEqual([
      { from: 0, to: 4 },
      { from: 5, to: idx.sentences.length - 1 },
    ])
    expect(packRanges([], idx)).toEqual([{ from: 0, to: idx.sentences.length - 1 }])
  })
})

describe('AudioShare upload', () => {
  it('uploads one pack per prepared range, with appProperties, and skips unchanged packs', async () => {
    const drive = new FakeDrive()
    const a = device(drive)
    await prepare(a.store, [0, 1, 2, 3, 4, 5, 6])
    await a.share.upload('book')
    expect(drive.blobs.size).toBe(2)
    const props = [...drive.blobs.values()].map((f) => f.appProperties).sort((x, y) => Number(x.from) - Number(y.from))
    expect(props[0]).toMatchObject({ kind: 'lumen-audio', bookId: 'book', voice: 'kokoro', from: '0', to: '2', entries: '3' })
    expect(props[1]).toMatchObject({ from: '3', to: '6', entries: '4' })
    expect(a.share.snapshot.books.book.notUploaded).toEqual([])
    expect(a.share.snapshot.books.book.remote).toHaveLength(2)

    // nothing changed: no upload at all
    const uploads = drive.uploads
    await a.share.upload('book')
    expect(drive.uploads).toBe(uploads)

    // one sentence re-prepared (different audio): only that pack is replaced, in place
    const ids = [...drive.blobs.keys()]
    await a.store.putPrepared('book', 4, texts[4], audio(333), 2, 'kokoro')
    await a.share.upload('book')
    expect(drive.uploads).toBe(uploads + 1)
    expect([...drive.blobs.keys()]).toEqual(ids)
  })

  it('waits for a half-prepared range while its preparation still runs', async () => {
    const drive = new FakeDrive()
    let running = true
    const a = device(drive, { deps: { preparing: (_b, from) => running && from === 3 } })
    await prepare(a.store, [0, 1, 2, 3])
    await a.share.upload('book')
    expect([...drive.blobs.values()].map((f) => f.appProperties.from)).toEqual(['0'])
    running = false
    await a.share.upload('book')
    expect(drive.blobs.size).toBe(2)
  })

  it('says so when Drive is full', async () => {
    const drive = new FakeDrive()
    const a = device(drive)
    await prepare(a.store, [0, 1, 2])
    drive.failNextUpload = new DriveHttpError(403, 'storageQuotaExceeded', 'Google Drive error 403')
    await a.share.upload('book')
    expect(a.errors[0]).toMatch(/Google Drive is full/)
    expect(a.share.snapshot.error).toMatch(/Google Drive is full/)
    expect(a.share.snapshot.books.book.upload).toBeUndefined()
  })

  it('retries passing errors, pauses offline and resumes when back', async () => {
    const drive = new FakeDrive()
    let online = true
    const a = device(drive, { deps: { online: () => online } })
    await prepare(a.store, [0, 1, 2])
    drive.failNextUpload = new DriveHttpError(503, 'backendError', 'Google Drive error 503')
    await a.share.upload('book')
    expect(drive.blobs.size).toBe(1)

    await prepare(a.store, [3, 4, 5, 6])
    online = false
    await a.share.upload('book')
    expect(drive.blobs.size).toBe(1)
    expect(a.errors).toEqual([])
    online = true
    a.share.resume()
    await a.share.idle()
    expect(drive.blobs.size).toBe(2)
  })
})

describe('AudioShare download', () => {
  async function preparedInDrive() {
    const drive = new FakeDrive()
    const pc = device(drive, { voice: 'kokoro' })
    await prepare(pc.store, [0, 1, 2, 3, 4, 5, 6])
    await pc.share.upload('book')
    return { drive, pc }
  }

  it('writes rows the player finds (same key and hash), even with another voice selected', async () => {
    const { drive } = await preparedInDrive()
    const phone = device(drive, { voice: 'piper' })
    await phone.share.download('book')
    expect(drive.downloads).toBe(2)
    expect(phone.marks.sort()).toEqual([0, 1, 2, 3, 4, 5, 6])
    const row = await phone.db.audio.get('book:4')
    expect(row).toMatchObject({ key: 'book:4', hash: audioHash('kokoro', texts[4]), textHash: textHash(texts[4]), prepared: 1, voice: 'kokoro' })
    // the phone's player (voice: piper) gets the prepared Kokoro audio
    const got = await phone.store.get('book', 4, texts[4])
    expect(got?.prepared).toBe(true)
    expect(got?.duration).toBe(1.4)
    expect(row!.size).toBe(104)
    expect(new Uint8Array(await got!.blob.arrayBuffer())).toEqual(new Uint8Array(await audio(104).arrayBuffer()))
    // the same text check still applies: a different sentence text gets nothing
    expect(await phone.store.get('book', 4, 'Something else.')).toBeNull()
    // ...and Contents counts it as ready
    const items = texts.map((text, index) => ({ index, text }))
    expect((await phone.store.lookup('book', items)).cached.size).toBe(7)
    expect(phone.share.snapshot.books.book.missing).toEqual([])
    // nothing to upload back: it came from Drive
    expect(phone.share.snapshot.books.book.notUploaded).toEqual([])
    const uploads = drive.uploads
    await phone.share.upload('book')
    expect(drive.uploads).toBe(uploads)
  })

  it('played (non-prepared) audio of the live voice never replaces prepared audio', async () => {
    const { drive } = await preparedInDrive()
    const phone = device(drive, { voice: 'piper' })
    await phone.share.download('book')
    await phone.store.put('book', 2, texts[2], audio(999, 'audio/wav'), 9)
    expect((await phone.store.get('book', 2, texts[2]))?.duration).toBe(1.2)
  })

  it('only downloads by itself on Wi‑Fi; "Download now" works on any network', async () => {
    const { drive } = await preparedInDrive()
    let wifi = false
    const phone = device(drive, { deps: { autoAllowed: () => wifi } })
    await phone.share.download('book')
    expect(drive.downloads).toBe(0)
    expect(phone.share.snapshot.books.book.missing).toHaveLength(2)
    // one chapter by hand
    await phone.share.download('book', { manual: true, range: { from: 3, to: 6 } })
    expect(drive.downloads).toBe(1)
    expect(phone.share.snapshot.books.book.missing.map((p) => p.from)).toEqual([0])
    wifi = true
    await phone.share.download('book')
    expect(drive.downloads).toBe(2)
    expect(phone.share.snapshot.books.book.missing).toEqual([])
  })

  it('starts with the chapter being read', async () => {
    const { drive } = await preparedInDrive()
    const order: string[] = []
    const download = drive.download.bind(drive)
    drive.download = async (id) => {
      order.push(drive.blobs.get(id)!.appProperties.from)
      return download(id)
    }
    const phone = device(drive, { deps: { position: () => 5 } })
    await phone.share.download('book')
    expect(order).toEqual(['3', '0'])
  })

  it('a book whose prepared audio was deleted here is not downloaded again by itself', async () => {
    const { drive } = await preparedInDrive()
    const blocked = new Set<string>()
    const phone = device(drive, { deps: { isAutoBlocked: (b) => blocked.has(b), setAutoBlocked: (b, on) => void (on ? blocked.add(b) : blocked.delete(b)) } })
    await phone.share.download('book')
    await phone.store.deletePrepared('book')
    phone.share.localDeleted('book')
    await phone.share.download('book')
    expect(drive.downloads).toBe(2)
    // Drive keeps its copies
    expect(drive.blobs.size).toBe(2)
    await phone.share.download('book', { manual: true })
    expect(drive.downloads).toBe(4)
    expect(blocked.size).toBe(0)
  })

  it('Remove from Drive deletes the packs only', async () => {
    const { drive, pc } = await preparedInDrive()
    expect((await pc.share.listAll()).get('book')).toEqual({ bytes: expect.any(Number), packs: 2 })
    await pc.share.remove('book')
    expect(drive.blobs.size).toBe(0)
    expect((await pc.store.preparedUsage()).get('book')?.count).toBe(7)
    expect(pc.share.snapshot.books.book.notUploaded).toHaveLength(2)
  })
})

/** <audio> stand-in that "plays" each blob for a moment, then fires ended. */
class FakeAudio implements AudioLike {
  src = ''
  currentTime = 0
  playbackRate = 1
  preservesPitch = false
  volume = 1
  paused = true
  private handlers: Record<string, Array<() => void>> = {}
  addEventListener(t: string, fn: () => void) {
    ;(this.handlers[t] ??= []).push(fn)
  }
  removeAttribute() {}
  async play() {
    this.paused = false
    setTimeout(() => {
      this.paused = true
      this.handlers.ended?.forEach((f) => f())
    }, 5)
  }
  pause() {
    this.paused = true
  }
}

describe('voice mismatch', () => {
  it('plays prepared audio of another voice with zero live synthesis and without loading the live voice', async () => {
    const drive = new FakeDrive()
    const pc = device(drive, { voice: 'kokoro' })
    await prepare(pc.store, [0, 1, 2])
    await pc.share.upload('book')
    const phone = device(drive, { voice: 'piper' })
    await phone.share.download('book')

    const backend = new FakeTtsBackend()
    const init = vi.spyOn(backend, 'init')
    const before = vi.fn()
    const player = new Player({ backend, store: phone.store, audio: new FakeAudio(), prefetch: 3, beforeGenerate: before, createUrl: () => 'blob:x', revokeUrl: () => {} })
    const durations: number[] = []
    player.on('chunk', (c) => durations.push(c.duration))
    const all = [...texts, 'Not prepared.']
    player.setSource({ bookId: 'book', count: all.length, text: (i) => all[i] }, 0)
    player.play()
    await vi.waitFor(() => expect(player.index).toBeGreaterThanOrEqual(2), { timeout: 2000 })
    // sentences 0..2 came from the prepared Kokoro audio (durations for word timing included)
    expect(durations.slice(0, 3)).toEqual([1, 1.1, 1.2])
    // prefetch went on to sentence 3 (not prepared): only that one asked for the live voice
    await vi.waitFor(() => expect(backend.calls.length).toBeGreaterThan(0))
    expect(backend.calls).not.toContain(texts[0])
    expect(backend.calls).not.toContain(texts[1])
    expect(backend.calls).not.toContain(texts[2])
    expect(before).toHaveBeenCalled()
    expect(init).not.toHaveBeenCalled()
    player.destroy()
  })

  it('never calls the live voice while every sentence ahead is prepared', async () => {
    const drive = new FakeDrive()
    const pc = device(drive, { voice: 'kokoro' })
    await prepare(pc.store, [0, 1, 2, 3, 4, 5, 6])
    await pc.share.upload('book')
    const phone = device(drive, { voice: 'piper' })
    await phone.share.download('book')
    const backend = new FakeTtsBackend()
    const before = vi.fn()
    const player = new Player({ backend, store: phone.store, audio: new FakeAudio(), prefetch: 3, beforeGenerate: before, createUrl: () => 'blob:x', revokeUrl: () => {} })
    player.setSource({ bookId: 'book', count: texts.length, text: (i) => texts[i] }, 0)
    player.play()
    await vi.waitFor(() => expect(player.state).toBe('ended'), { timeout: 3000 })
    expect(backend.calls).toEqual([])
    expect(before).not.toHaveBeenCalled()
  })
})

describe('Wi‑Fi rule', () => {
  it('auto-downloads on Wi‑Fi/Ethernet or an unknown network, never on cellular or with Data Saver', () => {
    expect(autoDownloadAllowed(undefined)).toBe(true)
    expect(autoDownloadAllowed({})).toBe(true)
    expect(autoDownloadAllowed({ saveData: true })).toBe(false)
    expect(autoDownloadAllowed({ type: 'wifi' })).toBe(true)
    expect(autoDownloadAllowed({ type: 'ethernet' })).toBe(true)
    expect(autoDownloadAllowed({ type: 'cellular' })).toBe(false)
    expect(autoDownloadAllowed({ type: 'wifi', saveData: true })).toBe(false)
  })
})

describe('GoogleDriveClient uploads', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uploads big packs resumably in chunks and resumes after a failed chunk', async () => {
    const total = MULTIPART_LIMIT + UPLOAD_CHUNK + 1000
    const blob = new Blob([new Uint8Array(total)])
    const calls: Array<{ url: string; method: string; range?: string }> = []
    let received = 0
    let failedOnce = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const headers = (init.headers ?? {}) as Record<string, string>
        calls.push({ url, method: init.method ?? 'GET', range: headers['Content-Range'] })
        if (url.includes('uploadType=resumable')) return new Response('', { status: 200, headers: { Location: 'https://upload.example/session' } })
        const range = headers['Content-Range']
        if (range.startsWith('bytes */')) return new Response('', { status: 308, headers: received ? { Range: `bytes=0-${received - 1}` } : {} })
        if (!failedOnce && received > 0) {
          failedOnce = true
          return new Response('{"error":{"errors":[{"reason":"backendError"}]}}', { status: 503 })
        }
        const [, a, b] = /bytes (\d+)-(\d+)\//.exec(range)!
        expect(Number(a)).toBe(received)
        received = Number(b) + 1
        if (received < total) return new Response('', { status: 308, headers: { Range: `bytes=0-${received - 1}` } })
        return new Response('{"id":"new-file"}', { status: 200 })
      }),
    )
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const client = new GoogleDriveClient(async () => 'tok')
    const progress: number[] = []
    const p = client.uploadAppBlob({ name: 'x.lmap', blob, appProperties: { kind: 'lumen-audio' } }, (s) => progress.push(s))
    await vi.runAllTimersAsync()
    expect(await p).toEqual({ id: 'new-file' })
    vi.useRealTimers()
    expect(received).toBe(total)
    expect(calls[0].url).toContain('uploadType=resumable')
    expect(calls.some((c) => c.range?.startsWith('bytes */'))).toBe(true)
    expect(progress.at(-1)).toBe(total)
  })

  it('small packs go in one multipart request; a full Drive is reported as such', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":{"errors":[{"reason":"storageQuotaExceeded"}]}}', { status: 403 })),
    )
    const client = new GoogleDriveClient(async () => 'tok')
    const err = await client.uploadAppBlob({ name: 'x', blob: new Blob(['abc']), appProperties: {} }).catch((e) => e)
    expect(err).toBeInstanceOf(DriveHttpError)
    expect(err.quotaFull).toBe(true)
    expect(String((fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])).toContain('uploadType=multipart')
  })
})
