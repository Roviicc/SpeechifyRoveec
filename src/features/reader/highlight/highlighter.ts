import type { BookIndex } from '@/engine/book/bookIndex'
import type { HighlightRow } from '@/data/db'
import type { TextSurface } from './surface'

type HighlightRegistry = Map<string, unknown>
interface HighlightCtor {
  new (...ranges: Range[]): { priority: number }
}

function registry(): HighlightRegistry | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS
  return css?.highlights ?? null
}
function HighlightClass(): HighlightCtor | null {
  return (globalThis as { Highlight?: HighlightCtor }).Highlight ?? null
}

const NAMES = ['tts-sentence', 'tts-word', 'skipped', 'search-hit', 'user-yellow', 'user-green', 'user-blue', 'user-pink']

/**
 * Paints reading highlights with the CSS Custom Highlight API (no DOM mutation, so it is cheap
 * enough to update every animation frame).
 */
export class Highlighter {
  surface: TextSurface | null = null
  index: BookIndex | null = null
  sentence = -1
  word: { start: number; end: number } | null = null
  showSentence = true
  showWord = true
  private user: HighlightRow[] = []
  private search: { block: number; start: number; end: number } | null = null

  private set(name: string, ranges: Range[], priority = 0) {
    const reg = registry()
    const H = HighlightClass()
    if (!reg || !H) return
    if (!ranges.length) {
      reg.delete(name)
      return
    }
    const h = new H(...ranges)
    h.priority = priority
    reg.set(name, h)
  }

  attach(surface: TextSurface | null, index: BookIndex | null) {
    this.surface = surface
    this.index = index
    this.refresh()
  }

  setSentence(i: number) {
    this.sentence = i
    this.word = null
    this.paintSentence()
    this.set('tts-word', [], 2)
  }

  setWord(w: { start: number; end: number } | null) {
    if (w?.start === this.word?.start && w?.end === this.word?.end) return
    this.word = w
    this.paintWord()
  }

  private paintSentence() {
    const s = this.index?.sentences[this.sentence]
    this.set('tts-sentence', s && this.surface && this.showSentence ? this.surface.rangesFor(s.block, s.start, s.end) : [], 1)
  }

  private paintWord() {
    const s = this.index?.sentences[this.sentence]
    const w = this.word
    this.set('tts-word', s && w && this.surface && this.showWord ? this.surface.rangesFor(s.block, w.start, w.end) : [], 2)
  }

  setUserHighlights(rows: HighlightRow[]) {
    this.user = rows
    this.paintUser()
  }

  private paintUser() {
    const groups: Record<string, Range[]> = { yellow: [], green: [], blue: [], pink: [] }
    const idx = this.index
    if (this.surface && idx) {
      for (const h of this.user) {
        for (let b = h.start.block; b <= h.end.block && b < idx.blocks.length; b++) {
          const s = b === h.start.block ? h.start.offset : 0
          const e = b === h.end.block ? h.end.offset : idx.blocks[b].text.length
          if (e > s) groups[h.color]?.push(...this.surface.rangesFor(b, s, e))
        }
      }
    }
    for (const [color, ranges] of Object.entries(groups)) this.set(`user-${color}`, ranges, 0)
  }

  setSearchHit(hit: { block: number; start: number; end: number } | null) {
    this.search = hit
    this.set('search-hit', hit && this.surface ? this.surface.rangesFor(hit.block, hit.start, hit.end) : [], 3)
  }

  private paintSkipped() {
    const ranges: Range[] = []
    if (this.surface?.dimSkipped && this.index) {
      for (const b of this.index.blocks) for (const [s, e] of b.skipped) ranges.push(...this.surface.rangesFor(b.index, s, e))
    }
    this.set('skipped', ranges, 0)
  }

  /** Re-create all ranges (after the DOM changed, e.g. a PDF page rendered). */
  refresh() {
    this.paintSentence()
    this.paintWord()
    this.paintUser()
    this.paintSkipped()
    this.setSearchHit(this.search)
  }

  clear() {
    const reg = registry()
    for (const n of NAMES) reg?.delete(n)
  }
}
