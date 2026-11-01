import { buildBookIndex, sentenceAt, type BookIndex } from '../../engine/doc/bookIndex'
import type { BookDoc } from '../../engine/doc/types'
import type { Locator } from '../../data/db'
import { useSettings, type Settings } from '../../store/settings'

type IndexSettings = Pick<Settings, 'skip' | 'dictionary'>

/** Changes whenever a setting that affects the sentence index (smart skip, pronunciation) changes. */
export function indexSettingsKey(s: IndexSettings): string {
  return JSON.stringify([s.skip, s.dictionary])
}

export function indexBook(doc: BookDoc, s: IndexSettings): BookIndex {
  return buildBookIndex(doc, { skip: s.skip, dictionary: s.dictionary })
}

/** Sentence to start at: an index, a locator, or the beginning. */
export function resolveStart(idx: BookIndex, start?: Locator | number): number {
  if (typeof start === 'number') return start
  return start ? sentenceAt(idx, start.block, start.offset) : 0
}

export interface SettingsWatch {
  /** current player speed, to tell a real change from any other settings update */
  speed(): number
  /** speed changed in settings (e.g. replaced by sync from another device) */
  onSpeed(speed: number): void
  /** smart-skip or pronunciation settings changed: the index must be rebuilt */
  onIndexSettings(): void
}

export function watchSettings(w: SettingsWatch): () => void {
  let key = indexSettingsKey(useSettings.getState())
  return useSettings.subscribe((st) => {
    if (st.speed !== w.speed()) w.onSpeed(st.speed)
    const next = indexSettingsKey(st)
    if (next !== key) {
      key = next
      w.onIndexSettings()
    }
  })
}
