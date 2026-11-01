import { useCallback, useEffect, useMemo, useState } from 'react'
import { session } from '@/session/session'
import { usePlayback } from '@/state/playback'
import { sentenceAt, type BookIndex } from '@/engine/book/bookIndex'
import type { BookmarkRow, HighlightColor, HighlightRow } from '@/data/db'
import { addBookmark, addHighlight, deleteBookmark, listBookmarks, listHighlights, onDataChange } from '@/data/repo'
import { syncSoon } from '@/sync/syncService'
import type { SelectionInfo } from '@/features/reader/highlight/SelectionToolbar'

/** Bookmarks and highlights of a book (kept fresh on data changes) plus the actions on them. */
export function useNotes(bookId: string, index: BookIndex | null) {
  const [bookmarks, setBookmarks] = useState<BookmarkRow[]>([])
  const [highlights, setHighlights] = useState<HighlightRow[]>([])
  const current = usePlayback((s) => s.index)

  const reload = useCallback(() => {
    void listBookmarks(bookId).then(setBookmarks)
    void listHighlights(bookId).then(setHighlights)
  }, [bookId])
  useEffect(() => {
    reload()
    return onDataChange(reload)
  }, [reload])

  /** The bookmark on the sentence being read, if any. */
  const bookmarkHere = useMemo(() => {
    if (!index) return null
    return bookmarks.find((b) => sentenceAt(index, b.locator.block, b.locator.offset) === current) ?? null
  }, [bookmarks, index, current])

  const toggleBookmark = async () => {
    if (bookmarkHere) {
      await deleteBookmark(bookmarkHere.id)
      syncSoon()
      return
    }
    const loc = session().locator()
    const sent = index?.sentences[current]
    if (!loc || !sent || !index) return
    await addBookmark(bookId, loc, index.blocks[sent.block].text.slice(sent.start, sent.end).slice(0, 140))
    syncSoon()
  }

  /** Saves a highlight for a text selection; resolves to the new row (null without an index). */
  const highlightSelection = async (sel: SelectionInfo, color: HighlightColor): Promise<HighlightRow | null> => {
    if (!index) return null
    const loc = (p: { block: number; offset: number }) => ({ section: index.blocks[p.block].section, block: p.block, offset: p.offset })
    const row = await addHighlight({ bookId, start: loc(sel.start), end: loc(sel.end), text: sel.text.slice(0, 1000), color, note: '' })
    syncSoon()
    return row
  }

  return { bookmarks, highlights, bookmarkHere, toggleBookmark, highlightSelection }
}
