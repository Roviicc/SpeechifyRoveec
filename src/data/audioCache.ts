import type { AudioStore } from '@/engine/voice/player/player'
import { compressWav } from '@/engine/voice/player/opus'
import { db, type AudioRow, type LumenDB } from './db'
import { hashText } from './util'

export const AUDIO_CACHE_LIMIT = 500 * 1024 * 1024

/** Row key of a sentence's audio. Together with audioHash it identifies the audio (e.g. for export). */
export function audioKey(bookId: string, index: number): string {
  return `${bookId}:${index}`
}

/** Hash of what was spoken and by which voice: audio is only reused when both match. */
export function audioHash(voice: string, text: string): string {
  return hashText(voice + '|' + text)
}

export interface PreparedUsage {
  bytes: number
  count: number
}

/**
 * IndexedDB audio cache keyed by bookId + sentence index (+ voice/text hash to detect edits and voice changes).
 * Played audio is LRU-capped; *prepared* audio (generated ahead from Contents) is marked `prepared` and never evicted,
 * only removed with its book or from Settings → Storage. Audio is stored as Ogg Opus where WebCodecs can encode it.
 */
export class DexieAudioStore implements AudioStore {
  private writes = 0
  /** voice model id mixed into the text hash, so Kokoro and Piper audio never get mixed up */
  voice: () => string = () => ''
  constructor(
    private readonly database: LumenDB = db,
    private readonly limit = AUDIO_CACHE_LIMIT,
    /** turns a freshly generated WAV into what is stored (Opus); identity in tests */
    private readonly compress: (b: Blob) => Promise<Blob> = compressWav,
  ) {}

  async get(bookId: string, index: number, text: string) {
    const row = await this.database.audio.get(audioKey(bookId, index))
    if (!row || row.hash !== audioHash(this.voice(), text)) return null
    void this.database.audio.update(row.key, { lastUsed: Date.now() })
    return { blob: row.blob, duration: row.duration }
  }

  async put(bookId: string, index: number, text: string, blob: Blob, duration: number) {
    await this.write(bookId, index, audioHash(this.voice(), text), blob, duration, false)
    if (++this.writes % 25 === 0) await this.evict()
  }

  /** Store prepared audio (protected from eviction). `voice` is the voice that generated it. */
  async putPrepared(bookId: string, index: number, text: string, blob: Blob, duration: number, voice = this.voice()) {
    await this.write(bookId, index, audioHash(voice, text), blob, duration, true)
  }

  private async write(bookId: string, index: number, hash: string, blob: Blob, duration: number, prepared: boolean) {
    const stored = await this.compress(blob)
    const key = audioKey(bookId, index)
    // the player and the preparer can both make the same sentence: never drop an existing "prepared" mark
    const old = prepared ? undefined : await this.database.audio.get(key)
    const keep = old?.prepared && old.hash === hash
    const row: AudioRow = { key, bookId, hash, blob: stored, duration, size: stored.size, lastUsed: Date.now() }
    if (prepared || keep) row.prepared = 1
    await this.database.audio.put(row)
  }

  /**
   * Which of these sentences already have audio for `voice` (one batched read). `prepared` lists the ones
   * protected from eviction.
   */
  async lookup(bookId: string, items: Array<{ index: number; text: string }>, voice = this.voice()): Promise<{ cached: Set<number>; prepared: Set<number> }> {
    const rows = await this.database.audio.bulkGet(items.map((it) => audioKey(bookId, it.index)))
    const cached = new Set<number>()
    const prepared = new Set<number>()
    rows.forEach((row, k) => {
      if (!row || row.hash !== audioHash(voice, items[k].text)) return
      cached.add(items[k].index)
      if (row.prepared) prepared.add(items[k].index)
    })
    return { cached, prepared }
  }

  /** Protect already cached sentences from eviction (they are part of a prepared range). */
  async markPrepared(bookId: string, indexes: number[]) {
    if (!indexes.length) return
    await this.database.audio.bulkUpdate(indexes.map((i) => ({ key: audioKey(bookId, i), changes: { prepared: 1 as const } })))
  }

  async evict() {
    let total = 0
    const keys: string[] = []
    await this.database.audio
      .orderBy('lastUsed')
      .reverse()
      .each((row) => {
        if (row.prepared) return
        total += row.size
        if (total > this.limit) keys.push(row.key)
      })
    if (keys.length) await this.database.audio.bulkDelete(keys)
  }

  /** Size of the evictable cache (prepared audio not included). */
  async totalSize(): Promise<number> {
    let total = 0
    await this.database.audio.each((r) => {
      if (!r.prepared) total += r.size
    })
    return total
  }

  /** Prepared audio per book. */
  async preparedUsage(): Promise<Map<string, PreparedUsage>> {
    const out = new Map<string, PreparedUsage>()
    await this.database.audio.each((r) => {
      if (!r.prepared) return
      const u = out.get(r.bookId) ?? { bytes: 0, count: 0 }
      u.bytes += r.size
      u.count++
      out.set(r.bookId, u)
    })
    return out
  }

  async preparedTotal(): Promise<number> {
    let total = 0
    for (const u of (await this.preparedUsage()).values()) total += u.bytes
    return total
  }

  async deletePrepared(bookId: string) {
    await this.database.audio
      .where('bookId')
      .equals(bookId)
      .filter((r) => !!r.prepared)
      .delete()
  }

  /** Clear the played-audio cache (prepared audio stays). */
  async clear() {
    await this.database.audio.filter((r) => !r.prepared).delete()
  }
}

export const audioStore = new DexieAudioStore()
