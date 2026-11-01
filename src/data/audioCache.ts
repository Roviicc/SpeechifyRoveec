import type { AudioStore } from '@/engine/voice/player/player'
import { db, type LumenDB } from './db'
import { hashText } from './util'

export const AUDIO_CACHE_LIMIT = 500 * 1024 * 1024

/** IndexedDB audio cache keyed by bookId + sentence index (+ text hash to detect edits), LRU-capped. */
export class DexieAudioStore implements AudioStore {
  private writes = 0
  /** voice model id mixed into the text hash, so Kokoro and Piper audio never get mixed up */
  voice: () => string = () => ''
  constructor(
    private readonly database: LumenDB = db,
    private readonly limit = AUDIO_CACHE_LIMIT,
  ) {}

  async get(bookId: string, index: number, text: string) {
    const row = await this.database.audio.get(`${bookId}:${index}`)
    if (!row || row.hash !== hashText(this.voice() + '|' + text)) return null
    void this.database.audio.update(row.key, { lastUsed: Date.now() })
    return { blob: row.blob, duration: row.duration }
  }

  async put(bookId: string, index: number, text: string, blob: Blob, duration: number) {
    await this.database.audio.put({
      key: `${bookId}:${index}`,
      bookId,
      hash: hashText(this.voice() + '|' + text),
      blob,
      duration,
      size: blob.size,
      lastUsed: Date.now(),
    })
    if (++this.writes % 25 === 0) await this.evict()
  }

  async evict() {
    let total = 0
    const keys: string[] = []
    await this.database.audio
      .orderBy('lastUsed')
      .reverse()
      .each((row) => {
        total += row.size
        if (total > this.limit) keys.push(row.key)
      })
    if (keys.length) await this.database.audio.bulkDelete(keys)
  }

  async totalSize(): Promise<number> {
    let total = 0
    await this.database.audio.each((r) => (total += r.size))
    return total
  }

  async clear() {
    await this.database.audio.clear()
  }
}

export const audioStore = new DexieAudioStore()
