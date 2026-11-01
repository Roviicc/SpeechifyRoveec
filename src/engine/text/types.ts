/** A half-open character range [start, end) inside a block of display text. */
export interface Span {
  start: number
  end: number
}

/**
 * A rewrite applied to display text before it is sent to the voice.
 * `say === ''` means "skip" (text stays visible but is not read).
 */
export interface Replacement extends Span {
  say: string
  kind: 'citation' | 'footnote' | 'url' | 'pronunciation'
}

export interface SkipOptions {
  headersFooters: boolean
  pageNumbers: boolean
  citations: boolean
  footnotes: boolean
  urls: boolean
}

export const DEFAULT_SKIP: SkipOptions = {
  headersFooters: true,
  pageNumbers: true,
  citations: true,
  footnotes: true,
  urls: true,
}

export interface PronunciationEntry {
  word: string
  say: string
}
