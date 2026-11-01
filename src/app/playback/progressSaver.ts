import type { BookIndex } from '../../engine/doc/bookIndex'
import type { ProgressRow } from '../../data/db'
import { locatorOf } from './navigation'
import type { OpenBook } from './types'

/** Save at most this often while sentences advance (pause / hide / close always save). */
export const SAVE_INTERVAL_MS = 4000

export type ProgressInput = Omit<ProgressRow, 'updatedAt'>

export interface ProgressSnapshot {
  book: OpenBook | null
  index: BookIndex | null
  /** current sentence */
  sentence: number
}

/** The progress row for the current position, or null when there is nothing to save. */
export function progressRecord({ book, index, sentence }: ProgressSnapshot): ProgressInput | null {
  if (!book?.persist || !index) return null
  const loc = locatorOf(index, sentence)
  if (!loc) return null
  return {
    bookId: book.id,
    sentence,
    locator: loc,
    percent: index.totalChars ? index.cumChars[sentence] / index.totalChars : 0,
    sectionTitle: book.doc.sections[loc.section]?.title ?? '',
  }
}

/** Writes reading progress: on demand, or throttled while playing. */
export class ProgressSaver {
  private lastSaved = 0

  constructor(
    private snapshot: () => ProgressSnapshot,
    private save: (p: ProgressInput) => Promise<void>,
    private now: () => number = Date.now,
  ) {}

  async saveNow(): Promise<void> {
    const rec = progressRecord(this.snapshot())
    if (!rec) return
    this.lastSaved = this.now()
    await this.save(rec)
  }

  /** Save when the last save is older than SAVE_INTERVAL_MS. */
  saveIfDue() {
    if (this.now() - this.lastSaved > SAVE_INTERVAL_MS) void this.saveNow()
  }
}
