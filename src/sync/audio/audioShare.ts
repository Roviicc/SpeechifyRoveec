import { textHash, audioHash, type PackedAudio } from '@/data/audioCache'
import type { AudioRow } from '@/data/db'
import { DriveAuthError, DriveHttpError, type DriveClient } from '@/sync/drive/client'
import { NeedsSignIn } from '@/sync/drive/google'
import { decodePack, encodePack, PACK_KIND, packName, packProperties, packSig, parsePackProperties, type DecodedEntry, type RemotePack } from './pack'
import type { PackRange } from './packRanges'

/** What a device knows about one book's prepared audio in Drive. */
export interface BookShare {
  /** packs in Drive (null until listed) */
  remote: RemotePack[] | null
  /** packs in Drive with audio this device doesn't have yet */
  missing: RemotePack[]
  /** ranges with prepared audio here that Drive doesn't have (or has an older version of) */
  notUploaded: PackRange[]
  upload?: { done: number; total: number; current: PackRange }
  download?: { done: number; total: number; current: PackRange }
  /** the user deleted this book's prepared audio here: don't download it again by itself */
  autoBlocked?: boolean
}

export interface AudioShareState {
  books: Record<string, BookShare>
  /** last error worth telling the user (Drive full...) */
  error?: string
}

export interface ShareStore {
  preparedRows(bookId: string, items: Array<{ index: number; text: string }>): Promise<Map<number, AudioRow>>
  putPacked(bookId: string, entries: PackedAudio[], packId: string): Promise<number[]>
}

export interface AudioShareDeps {
  drive: DriveClient
  store: ShareStore
  /** Drive connected (with a usable token) and sharing turned on */
  enabled(): boolean
  /** spoken text of every sentence and the pack ranges, exactly as this device reads the book (null: book gone) */
  book(bookId: string): Promise<{ texts: string[]; ranges: PackRange[] } | null>
  /** where the reader is in this book (downloads start there) */
  position?(bookId: string): number
  /** a preparation run still covers (part of) this range: don't upload it half done */
  preparing?(bookId: string, from: number, to: number): boolean
  /** automatic downloads allowed on this network (Wi‑Fi) */
  autoAllowed?(): boolean
  online?(): boolean
  /** device-local "don't auto-download this book" flag (set after deleting its prepared audio here) */
  isAutoBlocked?(bookId: string): boolean
  setAutoBlocked?(bookId: string, blocked: boolean): void
  /** a sentence got prepared audio from Drive */
  onSentence?(bookId: string, index: number): void
  onError?(message: string): void
  /** waits between retries of a failed request (ms) */
  retryDelays?: number[]
}

export class DriveFullError extends Error {
  constructor() {
    super('Google Drive is full, so prepared audio can’t be uploaded. Free some space in Drive, then try again.')
    this.name = 'DriveFullError'
  }
}

class OfflineError extends Error {
  constructor() {
    super('offline')
    this.name = 'OfflineError'
  }
}

const KNOWN_VOICES = ['kokoro', 'piper']

const overlaps = (p: { from: number; to: number }, from: number, to: number) => p.from <= to && p.to >= from

/**
 * Shares prepared audio between devices through the user's Drive appDataFolder: one pack file per chapter range
 * (see pack.ts). Uploads after preparing (skipping packs whose content signature Drive already has), downloads
 * missing packs into the audio cache as prepared rows (automatically on Wi‑Fi, nearest chapter first, or by hand).
 * All Drive work runs one task at a time in the background; it pauses while offline and resumes when back.
 */
export class AudioShare {
  private state: AudioShareState = { books: {} }
  private listeners = new Set<(s: AudioShareState) => void>()
  private chain: Promise<unknown> = Promise.resolve()
  private queued = new Set<string>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  /** work that stopped because the device went offline: run again on resume() */
  private waiting = new Map<string, () => Promise<void>>()

  constructor(private readonly deps: AudioShareDeps) {}

  get snapshot(): AudioShareState {
    return this.state
  }

  subscribe(fn: (s: AudioShareState) => void): () => void {
    this.listeners.add(fn)
    fn(this.state)
    return () => this.listeners.delete(fn)
  }

  private setBook(bookId: string, patch: Partial<BookShare>) {
    const cur = this.state.books[bookId] ?? { remote: null, missing: [], notUploaded: [] }
    this.state = { ...this.state, books: { ...this.state.books, [bookId]: { ...cur, ...patch } } }
    this.emit()
  }

  private emit() {
    this.listeners.forEach((fn) => fn(this.state))
  }

  /** Resolves when all queued work is done (tests). */
  async idle(): Promise<void> {
    for (;;) {
      const c = this.chain
      await c.catch(() => {})
      if (c === this.chain && !this.timers.size) return
      if (this.timers.size) await new Promise((r) => setTimeout(r, 20))
    }
  }

  /** Run `op` after the work already queued (one Drive task at a time); same-key tasks that are still waiting merge. */
  private enqueue(key: string, op: () => Promise<void>): Promise<void> {
    if (this.queued.has(key)) return this.chain.then(() => {}, () => {})
    this.queued.add(key)
    const run = this.chain.then(async () => {
      this.queued.delete(key)
      if (!this.deps.enabled()) return
      try {
        await op()
      } catch (e) {
        this.handle(e, key, op)
      }
    })
    this.chain = run.catch(() => {})
    return run
  }

  private handle(e: unknown, key: string, op: () => Promise<void>) {
    if (e instanceof OfflineError) {
      this.waiting.set(key, op)
      return
    }
    if (e instanceof DriveAuthError || e instanceof NeedsSignIn) return
    const message = e instanceof DriveFullError ? e.message : `Couldn’t share prepared audio through Google Drive: ${(e as Error)?.message ?? e}`
    this.state = { ...this.state, error: message }
    this.emit()
    this.deps.onError?.(message)
  }

  /** Back online (or on Wi‑Fi again): run what was waiting. */
  resume() {
    const w = [...this.waiting]
    this.waiting.clear()
    for (const [key, op] of w) void this.enqueue(key, op)
  }

  private online() {
    return this.deps.online?.() ?? true
  }

  /** A Drive call with retries and back-off for passing trouble (network blips, rate limits, server errors). */
  private async retry<T>(fn: () => Promise<T>): Promise<T> {
    const delays = this.deps.retryDelays ?? [1000, 4000, 15000]
    for (let attempt = 0; ; attempt++) {
      if (!this.online()) throw new OfflineError()
      try {
        return await fn()
      } catch (e) {
        if (e instanceof DriveHttpError && e.quotaFull) throw new DriveFullError()
        const transient = (e instanceof DriveHttpError && e.transient) || e instanceof TypeError
        if (!transient) throw e
        if (!this.online()) throw new OfflineError()
        if (attempt >= delays.length) throw e
        await new Promise((r) => setTimeout(r, delays[attempt]))
      }
    }
  }

  // ---- listing ----

  private async listRemote(bookId: string): Promise<RemotePack[]> {
    const files = await this.retry(() => this.deps.drive.listAppFiles({ kind: PACK_KIND, bookId }))
    return files.map(parsePackProperties).filter((p): p is RemotePack => !!p && p.bookId === bookId)
  }

  /** Every pack in Drive, by book (Settings → Storage). */
  async listAll(): Promise<Map<string, { bytes: number; packs: number }>> {
    const out = new Map<string, { bytes: number; packs: number }>()
    if (!this.deps.enabled()) return out
    const files = await this.retry(() => this.deps.drive.listAppFiles({ kind: PACK_KIND }))
    for (const f of files) {
      const p = parsePackProperties(f)
      if (!p) continue
      const u = out.get(p.bookId) ?? { bytes: 0, packs: 0 }
      u.bytes += p.size
      u.packs++
      out.set(p.bookId, u)
    }
    return out
  }

  /** Local prepared audio of every range of a book, with each range's pack signature. */
  private async localRanges(bookId: string, texts: string[], ranges: PackRange[]) {
    const items = texts.map((text, index) => ({ index, text })).filter((it) => it.text)
    const rows = await this.deps.store.preparedRows(bookId, items)
    return ranges.map((r) => {
      const inRange = items.filter((it) => it.index >= r.from && it.index <= r.to)
      const have = inRange.filter((it) => rows.has(it.index)).map((it) => ({ it, row: rows.get(it.index)! }))
      const entries = have.map(({ it, row }) => ({
        index: it.index,
        hash: row.hash,
        textHash: row.textHash ?? textHash(it.text),
        voice: row.voice ?? KNOWN_VOICES.find((v) => audioHash(v, it.text) === row.hash) ?? 'unknown',
        duration: row.duration,
        blob: row.blob,
        length: row.blob.size,
      }))
      return {
        range: r,
        total: inRange.length,
        entries,
        /** every row came from Drive (nothing new to upload) */
        fromDrive: have.length > 0 && have.every(({ row }) => !!row.fromPack),
        sig: entries.length ? packSig(entries) : '',
      }
    })
  }

  /** Packs in Drive that hold audio this device doesn't have (by count of prepared sentences in their range). */
  private missingPacks(remote: RemotePack[], texts: string[], have: Set<number>): RemotePack[] {
    return remote.filter((p) => {
      let local = 0
      let readable = 0
      for (let i = Math.max(0, p.from); i <= Math.min(texts.length - 1, p.to); i++) {
        if (!texts[i]) continue
        readable++
        if (have.has(i)) local++
      }
      return local < Math.min(p.entries, readable)
    })
  }

  /** Look at Drive and this device for one book: what is in Drive, what is missing here, what isn't uploaded. */
  refresh(bookId: string): Promise<void> {
    return this.enqueue(`refresh:${bookId}`, () => this.doRefresh(bookId))
  }

  private async doRefresh(bookId: string) {
    const book = await this.deps.book(bookId)
    if (!book) return
    const remote = await this.listRemote(bookId)
    const local = await this.localRanges(bookId, book.texts, book.ranges)
    this.publishSummary(bookId, book.texts, remote, local)
  }

  private publishSummary(bookId: string, texts: string[], remote: RemotePack[], local: Awaited<ReturnType<AudioShare['localRanges']>>) {
    const have = new Set<number>()
    local.forEach((l) => l.entries.forEach((e) => have.add(e.index)))
    const notUploaded = local
      .filter((l) => l.entries.length && !l.fromDrive && !remote.some((p) => p.from === l.range.from && p.to === l.range.to && p.sig === l.sig))
      .map((l) => l.range)
    this.setBook(bookId, {
      remote,
      missing: this.missingPacks(remote, texts, have),
      notUploaded,
      autoBlocked: this.deps.isAutoBlocked?.(bookId) ?? false,
    })
  }

  // ---- upload ----

  /** Upload soon (after preparation wrote some sentences); calls within `ms` merge. */
  scheduleUpload(bookId: string, ms = 4000) {
    const key = `up:${bookId}`
    const t = this.timers.get(key)
    if (t) clearTimeout(t)
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key)
        void this.upload(bookId)
      }, ms),
    )
  }

  /** Upload every range of the book that has prepared audio here and isn't in Drive (or changed). */
  upload(bookId: string): Promise<void> {
    return this.enqueue(`up:${bookId}`, () => this.doUpload(bookId))
  }

  private async doUpload(bookId: string) {
    const book = await this.deps.book(bookId)
    if (!book) return
    let remote = await this.listRemote(bookId)
    const local = await this.localRanges(bookId, book.texts, book.ranges)
    const todo = local.filter((l) => {
      if (!l.entries.length || l.fromDrive) return false
      // half-prepared ranges wait for their preparation run to end (else the pack is uploaded again and again)
      if (l.entries.length < l.total && this.deps.preparing?.(bookId, l.range.from, l.range.to)) return false
      return !remote.some((p) => p.from === l.range.from && p.to === l.range.to && p.sig === l.sig)
    })
    this.publishSummary(bookId, book.texts, remote, local)
    for (let k = 0; k < todo.length; k++) {
      const l = todo[k]
      this.setBook(bookId, { upload: { done: k, total: todo.length, current: l.range } })
      try {
        const { blob, header, sig } = encodePack({ bookId, from: l.range.from, to: l.range.to }, l.entries)
        const existing = remote.find((p) => p.from === l.range.from && p.to === l.range.to)
        const props = packProperties(header, sig)
        const { id } = await this.retry(() =>
          this.deps.drive.uploadAppBlob({ id: existing?.id, name: packName(bookId, l.range.from, l.range.to), blob, appProperties: props }),
        )
        const pack = parsePackProperties({ id, size: blob.size, appProperties: props })!
        remote = [...remote.filter((p) => p.id !== id && p !== existing), pack]
        this.setBook(bookId, { remote, notUploaded: (this.state.books[bookId]?.notUploaded ?? []).filter((r) => r.from !== l.range.from || r.to !== l.range.to) })
      } catch (e) {
        this.setBook(bookId, { upload: undefined })
        throw e
      }
    }
    this.setBook(bookId, { upload: undefined })
    if (this.state.error) {
      this.state = { ...this.state, error: undefined }
      this.emit()
    }
  }

  // ---- download ----

  /**
   * Download packs this device doesn't have. Automatic runs (`manual` false) only on Wi‑Fi and not for books whose
   * prepared audio the user deleted here; a manual run (any network) also lifts that block. `range` limits it to
   * packs overlapping those sentences (one chapter).
   */
  download(bookId: string, opts: { manual?: boolean; range?: PackRange } = {}): Promise<void> {
    if (opts.manual) this.deps.setAutoBlocked?.(bookId, false)
    const key = `down:${bookId}:${opts.manual ? 'm' : 'a'}:${opts.range ? `${opts.range.from}-${opts.range.to}` : ''}`
    return this.enqueue(key, () => this.doDownload(bookId, opts))
  }

  private autoOk(bookId: string) {
    return (this.deps.autoAllowed?.() ?? true) && !(this.deps.isAutoBlocked?.(bookId) ?? false)
  }

  private async doDownload(bookId: string, opts: { manual?: boolean; range?: PackRange }) {
    if (!opts.manual && !this.autoOk(bookId)) return this.doRefresh(bookId)
    const book = await this.deps.book(bookId)
    if (!book) return
    const remote = await this.listRemote(bookId)
    let local = await this.localRanges(bookId, book.texts, book.ranges)
    this.publishSummary(bookId, book.texts, remote, local)
    let todo = this.state.books[bookId]?.missing ?? []
    if (opts.range) todo = todo.filter((p) => overlaps(p, opts.range!.from, opts.range!.to))
    // the chapter being read first, then onward, then the ones before (closest first)
    const pos = this.deps.position?.(bookId) ?? 0
    const rank = (p: RemotePack) => (p.from <= pos && p.to >= pos ? -1 : p.from > pos ? p.from - pos : 1e9 + (pos - p.to))
    todo = [...todo].sort((a, b) => rank(a) - rank(b))
    if (!todo.length) return

    // sentence text hashes of this device, to check (and if needed re-find) every entry's sentence
    const hashes = book.texts.map((t) => (t ? textHash(t) : ''))
    const byHash = new Map<string, number[]>()
    hashes.forEach((h, i) => h && (byHash.get(h) ?? byHash.set(h, []).get(h)!).push(i))
    const localIndex = (e: DecodedEntry): number | null => {
      if (hashes[e.index] === e.textHash) return e.index
      // the sentence moved a little (e.g. a different smart-skip setting): the nearest sentence with the same text
      let best: number | null = null
      for (const i of byHash.get(e.textHash) ?? []) if (Math.abs(i - e.index) <= 200 && (best === null || Math.abs(i - e.index) < Math.abs(best - e.index))) best = i
      return best
    }

    try {
      for (let k = 0; k < todo.length; k++) {
        if (!opts.manual && !this.autoOk(bookId)) break
        const pack = todo[k]
        this.setBook(bookId, { download: { done: k, total: todo.length, current: { from: pack.from, to: pack.to } } })
        const blob = await this.retry(() => this.deps.drive.download(pack.id))
        const { entries } = await decodePack(blob)
        const packed: PackedAudio[] = []
        const used = new Set<number>()
        for (const e of entries) {
          const i = localIndex(e)
          if (i === null || used.has(i)) continue
          used.add(i)
          packed.push({ index: i, hash: e.hash, textHash: e.textHash, voice: e.voice, blob: e.blob, duration: e.duration })
        }
        const written = await this.deps.store.putPacked(bookId, packed, pack.id)
        written.forEach((i) => this.deps.onSentence?.(bookId, i))
      }
    } finally {
      local = await this.localRanges(bookId, book.texts, book.ranges)
      this.publishSummary(bookId, book.texts, remote, local)
      this.setBook(bookId, { download: undefined })
    }
  }

  // ---- removal ----

  /** Delete every pack of a book from Drive (Settings → Storage → Remove from Drive). Local audio stays. */
  remove(bookId: string): Promise<void> {
    return this.enqueue(`remove:${bookId}`, async () => {
      const remote = await this.listRemote(bookId)
      for (const p of remote) await this.retry(() => this.deps.drive.deleteAppFile(p.id))
      this.setBook(bookId, { remote: [], missing: [] })
      const book = await this.deps.book(bookId)
      if (book) this.publishSummary(bookId, book.texts, [], await this.localRanges(bookId, book.texts, book.ranges))
    })
  }

  /** The user deleted this book's prepared audio on this device: stop downloading it by itself. */
  localDeleted(bookId: string) {
    this.deps.setAutoBlocked?.(bookId, true)
    const b = this.state.books[bookId]
    if (b?.remote) this.setBook(bookId, { autoBlocked: true, missing: b.remote, notUploaded: [] })
  }
}
