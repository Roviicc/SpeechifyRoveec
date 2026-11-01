import { useEffect, useState } from 'react'
import { session } from '../../app/session'
import type { BookDoc } from '../../engine/doc/types'
import type { BookIndex } from '../../engine/doc/bookIndex'
import type { BookRow, ProgressRow } from '../../data/db'
import { getBook, getContent, getFile, getProgress, touchBook } from '../../data/repo'
import { reparseBook } from '../import/importBook'

/**
 * Loads a book (row, parsed content, original file for PDFs), opens it in the playback session
 * and tracks the session's sentence index. `onResumeOffer` is called with the saved progress when
 * the reader should offer to continue from it.
 */
export function useBookLoader(bookId: string, onResumeOffer: (p: ProgressRow) => void) {
  const [book, setBook] = useState<BookRow | null>(null)
  const [doc, setDoc] = useState<BookDoc | null>(null)
  const [file, setFile] = useState<Blob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState<BookIndex | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const row = await getBook(bookId)
        if (!row) throw new Error('This book is not in your library.')
        let content = await getContent(bookId)
        const blob = row.type === 'pdf' || !content ? await getFile(bookId) : null
        if (!content) {
          if (!blob) throw new Error('The book file is missing.')
          content = await reparseBook(row, blob)
        }
        const progress = await getProgress(bookId)
        if (cancelled) return
        setBook(row)
        setDoc(content)
        setFile(blob)
        session().open({ id: row.id, title: row.title, cover: row.cover, doc: content, persist: true }, session().book?.id === row.id ? undefined : progress?.locator)
        if (progress && progress.percent > 0.001 && !session().player.isActive) onResumeOffer(progress)
        void touchBook(bookId)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bookId, onResumeOffer])

  useEffect(() => session().onIndex(setIndex), [])

  return { book, doc, file, error, index }
}
