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

/** Hash of the spoken text alone: prepared audio is matched by this, whatever voice is selected. */
export function textHash(text: string): string {
  return hashText(text)
}

/** Voices whose prepared rows may predate `textHash` (their text is checked through the voice-mixed hash). */
const KNOWN_VOICES = ['kokoro', 'piper']

/** A prepared row whose audio says `text` (any voice). */
export function preparedSays(row: AudioRow, text: string): boolean {
  if (!row.prepared) return false
  if (row.textHash) return row.textHash === textHash(text)
  return KNOWN_VOICES.some((v) => row.hash === audioHash(v, text))
}

/** Audio of a Drive pack entry, ready to store as a prepared row. */
export interface PackedAudio {
  index: number
  hash: string
  textHash: string
  voice: string
  blob: Blob
  duration: number
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

  /**
   * Audio of a sentence: played audio of the current voice, or *prepared* audio of any voice (prepared audio wins:
   * a phone set to the fast voice still plays the natural audio prepared on the PC).
   */
  async get(bookId: string, index: number, text: string) {
    const row = await this.database.audio.get(audioKey(bookId, index))
    if (!row || (row.hash !== audioHash(this.voice(), text) && !preparedSays(row, text))) return null
    void this.database.audio.update(row.key, { lastUsed: Date.now() })
    return { blob: row.blob, duration: row.duration, prepared: !!row.prepared }
  }

  async put(bookId: string, index: number, text: string, blob: Blob, duration: number) {
    await this.write(bookId, index, text, this.voice(), blob, duration, false)
    if (++this.writes % 25 === 0) await this.evict()
  }

  /** Store prepared audio (protected from eviction). `voice` is the voice that generated it. */
  async putPrepared(bookId: string, index: number, text: string, blob: Blob, duration: number, voice = this.voice()) {
    await this.write(bookId, index, text, voice, blob, duration, true)
  }

  private async write(bookId: string, index: number, text: string, voice: string, blob: Blob, duration: number, prepared: boolean) {
    const hash = audioHash(voice, text)
    const key = audioKey(bookId, index)
    // the player and the preparer can both make the same sentence: never drop an existing "prepared" mark, and never
    // replace prepared audio of another voice with played audio
    const old = prepared ? undefined : await this.database.audio.get(key)
    if (old && preparedSays(old, text) && old.hash !== hash) return
    const keep = old?.prepared && old.hash === hash
    const stored = await this.compress(blob)
    const row: AudioRow = { key, bookId, hash, textHash: textHash(text), blob: stored, duration, size: stored.size, lastUsed: Date.now() }
    if (prepared || keep) {
      row.prepared = 1
      row.voice = voice
    }
    await this.database.audio.put(row)
  }

  /** Prepared rows (any voice) of these sentences whose audio says the sentence's text. */
  async preparedRows(bookId: string, items: Array<{ index: number; text: string }>): Promise<Map<number, AudioRow>> {
    const rows = await this.database.audio.bulkGet(items.map((it) => audioKey(bookId, it.index)))
    const out = new Map<number, AudioRow>()
    rows.forEach((row, k) => {
      if (row && preparedSays(row, items[k].text)) out.set(items[k].index, row)
    })
    return out
  }

  /**
   * Store audio that came from a Drive pack as prepared rows (already compressed: stored as is). Sentences that
   * already have prepared audio saying the same text are left alone. Returns the indexes written.
   */
  async putPacked(bookId: string, entries: PackedAudio[], packId: string): Promise<number[]> {
    if (!entries.length) return []
    const keys = entries.map((e) => audioKey(bookId, e.index))
    const old = await this.database.audio.bulkGet(keys)
    const now = Date.now()
    const rows: AudioRow[] = []
    entries.forEach((e, k) => {
      const o = old[k]
      if (o?.prepared && (o.textHash ? o.textHash === e.textHash : o.hash === e.hash)) return
      rows.push({
        key: keys[k],
        bookId,
        hash: e.hash,
        textHash: e.textHash,
        voice: e.voice,
        blob: e.blob,
        duration: e.duration,
        size: e.blob.size,
        lastUsed: now,
        prepared: 1,
        fromPack: packId,
      })
    })
    if (rows.length) await this.database.audio.bulkPut(rows)
    return rows.map((r) => Number(r.key.slice(bookId.length + 1)))
  }

  /**
   * Which of these sentences already have audio for `voice`, or prepared audio of any voice (one batched read).
   * `prepared` lists the ones protected from eviction.
   */
  async lookup(bookId: string, items: Array<{ index: number; text: string }>, voice = this.voice()): Promise<{ cached: Set<number>; prepared: Set<number> }> {
    const rows = await this.database.audio.bulkGet(items.map((it) => audioKey(bookId, it.index)))
    const cached = new Set<number>()
    const prepared = new Set<number>()
    rows.forEach((row, k) => {
      if (!row || (row.hash !== audioHash(voice, items[k].text) && !preparedSays(row, items[k].text))) return
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
