import type { BookDoc } from '@/engine/book/types'
import type { BookRow } from '@/data/db'
import { saveImportedBook } from '@/data/repo'
import { fileId } from '@/data/util'

export type BookType = 'epub' | 'pdf'

export function detectType(buf: ArrayBuffer, name: string, mime = ''): BookType | null {
  const head = new Uint8Array(buf.slice(0, 5))
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'pdf' // %PDF
  if (head[0] === 0x50 && head[1] === 0x4b) return 'epub' // PK (zip)
  if (/pdf/i.test(mime) || /\.pdf$/i.test(name)) return 'pdf'
  if (/epub/i.test(mime) || /\.epub$/i.test(name)) return 'epub'
  return null
}

/** Downscale a cover image to a small JPEG data URL for the library list. */
export async function makeThumbnail(blob: Blob, width = 120): Promise<string | undefined> {
  try {
    const bmp = await createImageBitmap(blob)
    const h = Math.round((bmp.height / bmp.width) * width)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = h
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, width, h)
    bmp.close()
    return canvas.toDataURL('image/jpeg', 0.75)
  } catch {
    return undefined
  }
}

async function parse(type: BookType, buf: ArrayBuffer, title: string, onProgress?: (f: number) => void) {
  if (type === 'pdf') {
    const { parsePdf } = await import('@/engine/book/pdf/parsePdf')
    return parsePdf(buf, title, onProgress)
  }
  const { parseEpub } = await import('@/engine/book/epub/parseEpub')
  return parseEpub(buf, title)
}

const baseName = (name: string) => name.replace(/\.(pdf|epub)$/i, '').replace(/[_]+/g, ' ').trim() || 'Untitled'

/** Parse a book file and store it (file + extracted text + metadata). Returns the book id. */
export async function importBook(
  blob: Blob,
  name: string,
  opts: { source?: 'local' | 'drive'; driveFileId?: string; onProgress?: (f: number) => void } = {},
): Promise<string> {
  const buf = await blob.arrayBuffer()
  const type = detectType(buf, name, blob.type)
  if (!type) throw new Error(`“${name}” is not an EPUB or PDF file.`)
  const id = await fileId(buf)
  const { doc, cover } = await parse(type, buf, baseName(name), opts.onProgress)
  if (!doc.sections.some((s) => s.blocks.length)) throw new Error('No readable text was found in this book.')
  const now = Date.now()
  const row: BookRow = {
    id,
    title: doc.title || baseName(name),
    author: doc.author,
    type,
    source: opts.source ?? 'local',
    driveFileId: opts.driveFileId,
    size: blob.size,
    addedAt: now,
    lastOpenedAt: now,
    cover: cover ? await makeThumbnail(cover) : undefined,
    updatedAt: now,
  }
  await saveImportedBook(row, new Blob([buf], { type: type === 'pdf' ? 'application/pdf' : 'application/epub+zip' }), doc)
  return id
}

/** Re-extract text for a stored book (after a parser upgrade). */
export async function reparseBook(row: BookRow, blob: Blob): Promise<BookDoc> {
  const buf = await blob.arrayBuffer()
  const { doc } = await parse(row.type, buf, row.title)
  doc.title = row.title
  await saveImportedBook(row, blob, doc)
  return doc
}
