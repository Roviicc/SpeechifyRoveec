import Dexie, { type EntityTable } from 'dexie'
import type { BookDoc } from '@/engine/book/types'

export interface BookRow {
  id: string
  title: string
  author?: string
  type: 'epub' | 'pdf'
  source: 'local' | 'drive'
  driveFileId?: string
  size: number
  addedAt: number
  lastOpenedAt: number
  /** small JPEG data URL */
  cover?: string
  updatedAt: number
}

export interface FileRow {
  bookId: string
  blob: Blob
}

export interface ContentRow {
  bookId: string
  version: number
  doc: BookDoc
}

/** Where the reader is: sentence index plus a stable text locator (survives smart-skip changes). */
export interface Locator {
  section: number
  block: number
  offset: number
}

export interface ProgressRow {
  bookId: string
  sentence: number
  locator: Locator
  percent: number
  sectionTitle: string
  updatedAt: number
}

export interface BookmarkRow {
  id: string
  bookId: string
  locator: Locator
  label: string
  createdAt: number
  updatedAt: number
  deleted?: boolean
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink'

export interface HighlightRow {
  id: string
  bookId: string
  /** global block index + offset of start/end */
  start: Locator
  end: Locator
  text: string
  color: HighlightColor
  note: string
  createdAt: number
  updatedAt: number
  deleted?: boolean
}

export interface AudioRow {
  key: string
  bookId: string
  hash: string
  blob: Blob
  duration: number
  size: number
  lastUsed: number
  /** generated ahead ("Prepare" in Contents): never evicted by the LRU */
  prepared?: 1
  /** hash of the spoken text alone (no voice): prepared audio is played whatever voice is selected */
  textHash?: string
  /** voice that made it (prepared rows) */
  voice?: string
  /** came from a Drive pack (id of the Drive file) */
  fromPack?: string
}

export interface SettingRow {
  key: string
  value: unknown
  updatedAt: number
}

export class LumenDB extends Dexie {
  books!: EntityTable<BookRow, 'id'>
  files!: EntityTable<FileRow, 'bookId'>
  content!: EntityTable<ContentRow, 'bookId'>
  progress!: EntityTable<ProgressRow, 'bookId'>
  bookmarks!: EntityTable<BookmarkRow, 'id'>
  highlights!: EntityTable<HighlightRow, 'id'>
  audio!: EntityTable<AudioRow, 'key'>
  settings!: EntityTable<SettingRow, 'key'>

  constructor(name = 'lumen') {
    super(name)
    this.version(1).stores({
      books: 'id, lastOpenedAt, addedAt, driveFileId',
      files: 'bookId',
      content: 'bookId',
      progress: 'bookId, updatedAt',
      bookmarks: 'id, bookId, updatedAt',
      highlights: 'id, bookId, updatedAt',
      audio: 'key, bookId, lastUsed',
      settings: 'key',
    })
  }
}

export const db = new LumenDB()
