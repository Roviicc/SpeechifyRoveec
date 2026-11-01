export type BlockKind = 'p' | 'h'
/** Block-level smart-skip classification (decided at import time). */
export type BlockSkip = 'header' | 'footer' | 'pagenum'

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
}

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

export const DOC_VERSION = 1
