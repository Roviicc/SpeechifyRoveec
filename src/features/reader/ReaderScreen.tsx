import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bookmark, ChevronDown, FileImage, FileText, ListTree, Locate, MoreHorizontal, Moon, NotebookPen, Search, Type, X } from 'lucide-react'
import { session } from '../../app/session'
import { navigate } from '../../app/router'
import { usePlayback } from '../../store/playback'
import { useSettings } from '../../store/settings'
import type { BookDoc } from '../../engine/doc/types'
import { sentenceAt, type BookIndex } from '../../engine/doc/bookIndex'
import type { BookRow, BookmarkRow, HighlightColor, HighlightRow, ProgressRow } from '../../data/db'
import {
  addBookmark,
  addHighlight,
  deleteBookmark,
  getBook,
  getContent,
  getFile,
  getProgress,
  listBookmarks,
  listHighlights,
  onDataChange,
  touchBook,
  updateHighlight,
} from '../../data/repo'
import { reparseBook } from '../import/importBook'
import { syncSoon } from '../../sync/syncService'
import { IconButton } from '../../ui/controls'
import { Sheet, anySheetOpen } from '../../ui/Sheet'
import { PlayerBar } from './PlayerBar'
import { ReflowView } from './ReflowView'
import { PdfView } from './PdfView'
import { NotesSheet, SearchSheet, SleepSheet, SpeedSheet, TextSettingsSheet, TocSheet } from './sheets'
import { SelectionToolbar, type SelectionInfo } from './SelectionToolbar'
import { useReaderSync } from './useReaderSync'
import type { TextSurface } from './surface'

type Panel = null | 'speed' | 'text' | 'toc' | 'sleep' | 'search' | 'notes' | 'menu' | 'note-edit'

export function ReaderScreen({ bookId }: { bookId: string }) {
  const [book, setBook] = useState<BookRow | null>(null)
  const [doc, setDoc] = useState<BookDoc | null>(null)
  const [file, setFile] = useState<Blob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState<BookIndex | null>(null)
  const [resume, setResume] = useState<ProgressRow | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [bookmarks, setBookmarks] = useState<BookmarkRow[]>([])
  const [highlights, setHighlights] = useState<HighlightRow[]>([])
  const [noteFor, setNoteFor] = useState<HighlightRow | null>(null)
  const [noteText, setNoteText] = useState('')
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [surface, setSurface] = useState<TextSurface | null>(null)
  const pdfMode = useSettings((s) => s.pdfMode)
  const setSettings = useSettings((s) => s.set)
  const current = usePlayback((s) => s.index)
  const state = usePlayback((s) => s.state)

  // ----- load -----
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
        if (progress && progress.percent > 0.001 && !session().player.isActive) setResume(progress)
        void touchBook(bookId)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bookId])

  useEffect(() => session().onIndex(setIndex), [])

  const reloadNotes = useCallback(() => {
    void listBookmarks(bookId).then(setBookmarks)
    void listHighlights(bookId).then(setHighlights)
  }, [bookId])
  useEffect(() => {
    reloadNotes()
    return onDataChange(reloadNotes)
  }, [reloadNotes])

  useEffect(() => {
    if (state === 'playing') setResume(null)
  }, [state])

  const mode: 'text' | 'original' = doc?.type === 'pdf' ? pdfMode : 'text'
  const sync = useReaderSync(container, surface, index)
  const { highlighter } = sync

  useEffect(() => {
    setSurface(null)
  }, [mode])

  useEffect(() => {
    highlighter.setUserHighlights(highlights)
  }, [highlighter, highlights, surface])

  // ----- keyboard shortcuts -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]') || anySheetOpen()) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const s = session()
      switch (e.key) {
        case ' ':
          e.preventDefault()
          s.toggle()
          break
        case 'ArrowRight':
          e.preventDefault()
          if (e.shiftKey) s.nextSection(1)
          else s.player.next()
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (e.shiftKey) s.nextSection(-1)
          else s.player.prev()
          break
        case '+':
        case '=':
          s.setSpeed(s.player.speed + 0.1)
          break
        case '-':
        case '_':
          s.setSpeed(s.player.speed - 0.1)
          break
        case 'Escape':
          setPanel(null)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const bookmarkHere = useMemo(() => {
    if (!index) return null
    return bookmarks.find((b) => sentenceAt(index, b.locator.block, b.locator.offset) === current) ?? null
  }, [bookmarks, index, current])

  const toggleBookmark = async () => {
    const s = session()
    if (bookmarkHere) {
      await deleteBookmark(bookmarkHere.id)
      syncSoon()
      return
    }
    const loc = s.locator()
    const sent = index?.sentences[current]
    if (!loc || !sent || !index) return
    await addBookmark(bookId, loc, index.blocks[sent.block].text.slice(sent.start, sent.end).slice(0, 140))
    syncSoon()
  }

  const onHighlight = async (sel: SelectionInfo, color: HighlightColor, withNote: boolean) => {
    if (!index) return
    const loc = (p: { block: number; offset: number }) => ({ section: index.blocks[p.block].section, block: p.block, offset: p.offset })
    const row = await addHighlight({ bookId, start: loc(sel.start), end: loc(sel.end), text: sel.text.slice(0, 1000), color, note: '' })
    syncSoon()
    if (withNote) {
      setNoteFor(row)
      setNoteText('')
      setPanel('note-edit')
    }
  }

  const jumpTo = (loc: { block: number; offset: number; section?: number }, play = false) => {
    setPanel(null)
    sync.scroller.resume()
    session().seekTo({ section: loc.section ?? 0, block: loc.block, offset: loc.offset }, play)
    requestAnimationFrame(() => sync.jumpToCurrent())
  }

  if (error)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-red-600">{error}</p>
        <button className="h-12 rounded-full bg-primary px-6 font-semibold text-on-primary" onClick={() => navigate({ name: 'library' })}>
          Back to library
        </button>
      </div>
    )

  const sectionLabel = doc?.type === 'pdf' ? 'page' : 'chapter'

  return (
    <div className="flex h-full flex-col bg-bg" data-testid="reader">
      {/* top bar */}
      <header className="safe-top z-20 flex h-14 shrink-0 items-center gap-0.5 border-b border-line bg-bg px-1.5 sm:px-3">
        <IconButton label="Back to library" onClick={() => navigate({ name: 'library' })} data-testid="reader-back">
          <ChevronDown size={26} />
        </IconButton>
        <h1 className="min-w-0 flex-1 truncate px-1 text-center text-[15px] font-semibold" data-testid="reader-title">
          {book?.title ?? ''}
        </h1>
        <IconButton label="Text settings" onClick={() => setPanel('text')} data-testid="aa-button">
          <Type size={21} />
        </IconButton>
        <IconButton label={bookmarkHere ? 'Remove bookmark' : 'Add bookmark'} onClick={() => void toggleBookmark()} data-testid="bookmark-button" aria-pressed={!!bookmarkHere}>
          <Bookmark size={21} className={bookmarkHere ? 'text-primary' : ''} fill={bookmarkHere ? 'currentColor' : 'none'} />
        </IconButton>
        {doc?.type === 'pdf' && (
          <IconButton
            label={mode === 'original' ? 'Switch to text view' : 'Switch to original view'}
            onClick={() => setSettings({ pdfMode: mode === 'original' ? 'text' : 'original' })}
            data-testid="pdf-mode"
            data-mode={mode}
          >
            {mode === 'original' ? <FileText size={21} /> : <FileImage size={21} />}
          </IconButton>
        )}
        <div className="relative">
          <IconButton label="More" onClick={() => setPanel(panel === 'menu' ? null : 'menu')} data-testid="more-button" aria-expanded={panel === 'menu'}>
            <MoreHorizontal size={22} />
          </IconButton>
          {panel === 'menu' && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setPanel(null)} />
              <div role="menu" className="anim-fade absolute top-12 right-0 z-40 w-56 overflow-hidden rounded-[16px] border border-line bg-bg py-1 shadow-[var(--shadow)]">
                {[
                  { k: 'search' as const, icon: <Search size={18} />, label: 'Search' },
                  { k: 'notes' as const, icon: <NotebookPen size={18} />, label: 'Notes & Bookmarks' },
                  { k: 'sleep' as const, icon: <Moon size={18} />, label: 'Sleep timer' },
                ].map((m) => (
                  <button key={m.k} role="menuitem" data-testid={`menu-${m.k}`} onClick={() => setPanel(m.k)} className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-[15px] hover:bg-surface">
                    {m.icon}
                    {m.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </header>

      {/* body */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={setContainer}
          className="h-full overflow-auto"
          data-testid="reader-scroll"
          tabIndex={-1}
          onClick={sync.onTap}
        >
          {!doc || !index ? (
            <p className="p-8 text-center text-muted">Opening…</p>
          ) : mode === 'original' && file ? (
            <PdfView file={file} index={index} scrollEl={container} onSurface={setSurface} onUpdated={sync.onSurfaceUpdated} />
          ) : (
            <ReflowView index={index} titles={doc.sections.map((s) => s.title)} onSurface={setSurface} />
          )}
        </div>

        {resume && doc && (
          <div className="anim-fade absolute top-3 right-3 left-3 z-10 mx-auto flex max-w-md items-center gap-3 rounded-[16px] border border-line bg-bg p-3 shadow-[var(--shadow)]" data-testid="resume-banner">
            <p className="min-w-0 flex-1 text-[15px]">
              Continue from <b className="font-semibold">{resume.sectionTitle || 'where you left off'}</b>?
            </p>
            <button className="h-10 rounded-full bg-primary px-4 text-sm font-semibold text-on-primary" onClick={() => (session().play(), setResume(null))} data-testid="resume-continue">
              Continue
            </button>
            <IconButton
              label="Start from the beginning"
              className="h-10 w-10"
              onClick={() => {
                session().seekTo(0)
                sync.jumpToCurrent()
                setResume(null)
              }}
            >
              <X size={18} />
            </IconButton>
          </div>
        )}

        {sync.jumpVisible && (
          <button
            onClick={sync.jumpToCurrent}
            data-testid="jump-to-current"
            className="anim-fade absolute bottom-4 left-1/2 z-10 flex h-11 -translate-x-1/2 items-center gap-2 rounded-full bg-fg px-5 text-sm font-semibold text-bg shadow-[var(--shadow)]"
          >
            <Locate size={17} /> Jump to current
          </button>
        )}

        {doc && (
          <button
            onClick={() => setPanel('toc')}
            aria-label="Table of contents"
            data-testid="toc-button"
            className="absolute bottom-4 left-4 z-10 grid h-12 w-12 place-items-center rounded-full border border-line bg-bg shadow-[var(--shadow)] hover:bg-surface"
          >
            <ListTree size={21} />
          </button>
        )}
      </div>

      <PlayerBar onSpeed={() => setPanel('speed')} sectionLabel={sectionLabel} />

      <SelectionToolbar container={container} surface={surface} onHighlight={(s, c, n) => void onHighlight(s, c, n)} onPlayFrom={(p) => sync.playFrom(p)} />

      <SpeedSheet open={panel === 'speed'} onClose={() => setPanel(null)} />
      <TextSettingsSheet open={panel === 'text'} onClose={() => setPanel(null)} />
      <SleepSheet open={panel === 'sleep'} onClose={() => setPanel(null)} />
      {doc && <TocSheet open={panel === 'toc'} onClose={() => setPanel(null)} doc={doc} index={index} />}
      {doc && (
        <SearchSheet
          open={panel === 'search'}
          onClose={() => {
            setPanel(null)
            highlighter.setSearchHit(null)
          }}
          index={index}
          doc={doc}
          onJump={(hit, play) => {
            highlighter.setSearchHit(hit)
            jumpTo({ block: hit.block, offset: hit.start, section: hit.section }, play)
            setTimeout(() => highlighter.setSearchHit(null), 4000)
          }}
        />
      )}
      {doc && <NotesSheet open={panel === 'notes'} onClose={() => setPanel(null)} bookmarks={bookmarks} highlights={highlights} doc={doc} onJump={(loc) => jumpTo(loc)} />}
      <Sheet open={panel === 'note-edit'} onClose={() => setPanel(null)} title="Add a note" testId="note-sheet">
        {noteFor && <p className="mb-3 line-clamp-3 text-sm text-muted italic">“{noteFor.text}”</p>}
        <textarea
          data-autofocus
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          rows={4}
          aria-label="Note"
          data-testid="note-input"
          className="w-full rounded-[16px] bg-surface p-4 text-[15px] outline-none focus:ring-2 focus:ring-primary"
          placeholder="Your note"
        />
        <button
          className="mt-3 h-12 w-full rounded-full bg-primary font-semibold text-on-primary"
          data-testid="note-save"
          onClick={() => {
            if (noteFor) void updateHighlight(noteFor.id, { note: noteText.trim() })
            syncSoon()
            setPanel(null)
          }}
        >
          Save note
        </button>
      </Sheet>
    </div>
  )
}
