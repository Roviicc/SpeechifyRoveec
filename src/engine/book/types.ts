/** 'img' blocks have empty text: they are displayed but never read and have no sentences. */
export type BlockKind = 'p' | 'h' | 'img'
/** Inline style: italic, bold, small caps, superscript, subscript, monospace. */
export type MarkKind = 'i' | 'b' | 'sc' | 'sup' | 'sub' | 'code'
/** [start, end, kind] — inline formatting range in block text (EPUB only). */
export type Mark = [number, number, MarkKind]
/** Block-level smart-skip classification (decided at import time). */
export type BlockSkip = 'header' | 'footer' | 'pagenum' | 'footnote' | 'caption' | 'table'

/** [textItemIndex, blockOffset, itemOffset, length] — maps block text back to pdf.js text items. */
export type PdfSpan = [number, number, number, number]

export interface Block {
  text: string
  kind: BlockKind
  skip?: BlockSkip
  /** footnote reference markers found in markup (EPUB noterefs), as [start, end) */
  notes?: Array<[number, number]>
  /** PDF only: page index (0-based) and text-item mapping */
  page?: number
  spans?: PdfSpan[]
  /** EPUB only: element ids that start in this block (for TOC fragment links) */
  ids?: string[]
  /** EPUB only: inline formatting ranges (sorted by start) */
  marks?: Mark[]
  /** heading level 1-3 (kind 'h'; h4-h6 map to 3) */
  level?: 1 | 2 | 3
  /** nesting depth of blockquotes / lists (indentation) */
  indent?: number
  /** inside a blockquote */
  quote?: boolean
  /** figure / table caption */
  caption?: boolean
  /** list item marker, e.g. '•' or '3.' (rendered outside the text, not read) */
  li?: string
  /** text contains '\n' line breaks to preserve (<br> / <pre>); 'pre' = preformatted (monospace, keep spaces) */
  pre?: 'br' | 'pre'
  /** table row: [start, end) of each cell in text; cells are joined by CELL_SEP */
  cells?: Array<[number, number]>
  /** image blocks: zip path of the image inside the EPUB, alt text, intrinsic size if known */
  src?: string
  alt?: string
  w?: number
  h?: number
}

/** Separator between table cells in a row block's text (hidden visually, gives TTS a pause). */
export const CELL_SEP = '; '

export interface Section {
  title: string
  blocks: Block[]
}

export interface TocEntry {
  title: string
  section: number
  /** block index inside the section, if the entry points into the middle of it */
  block?: number
  level: number
}

export interface BookDoc {
  version: 1
  type: 'epub' | 'pdf'
  title: string
  author?: string
  sections: Section[]
  toc: TocEntry[]
}

/** Bump when the parser output changes so stored books are re-parsed (see repo.getContent). */
export const DOC_VERSION = 2
/**
 * PDFs have their own version so PDF-only parser changes don't re-parse every EPUB. A change to the
 * shared document shape must bump both. 3 = column order, footnote/caption/table skip blocks.
 */
export const PDF_DOC_VERSION = 3

export function docVersion(type: BookDoc['type']): number {
  return type === 'pdf' ? PDF_DOC_VERSION : DOC_VERSION
}
