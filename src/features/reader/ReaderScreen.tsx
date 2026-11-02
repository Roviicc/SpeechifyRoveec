import { lazy, Suspense, useEffect, useState } from 'react'
import { ListTree, Locate, Play } from 'lucide-react'
import { session } from '@/session/session'
import { navigate } from '@/app/router'
import { useSettings } from '@/state/settings'
import type { HighlightColor, HighlightRow } from '@/data/db'
import { updateHighlight } from '@/data/repo'
import { syncSoon } from '@/sync/syncService'
import { PlayerBar } from '@/features/reader/player/PlayerBar'
import { ReflowView } from '@/features/reader/views/ReflowView'
import { NoteEditSheet, NotesSheet, SearchSheet, SleepSheet, SpeedSheet, TextSettingsSheet, TocSheet } from '@/features/reader/sheets'
import { SelectionToolbar, type SelectionInfo } from '@/features/reader/highlight/SelectionToolbar'
import { TopBar } from './TopBar'
import { WhereBar } from './WhereBar'
import { ReaderMenu } from './ReaderMenu'
import { ResumeBanner } from './ResumeBanner'
import { useReaderSync } from '@/features/reader/highlight/useReaderSync'
import { useBookLoader } from '@/features/reader/hooks/useBookLoader'
import { useResumeOffer } from '@/features/reader/hooks/useResumeOffer'
import { useNotes } from '@/features/reader/hooks/useNotes'
import { useReaderShortcuts } from '@/features/reader/hooks/useReaderShortcuts'
import { useSearchHit } from '@/features/reader/hooks/useSearchHit'
import type { Panel } from './panels'
import type { TextSurface } from '@/features/reader/highlight/surface'

// the PDF page viewer is only needed for PDFs in Original mode
const PdfView = lazy(() => import('@/features/reader/views/PdfView').then((m) => ({ default: m.PdfView })))

export function ReaderScreen({ bookId }: { bookId: string }) {
  const [panel, setPanel] = useState<Panel>(null)
  const [noteFor, setNoteFor] = useState<HighlightRow | null>(null)
  const [noteText, setNoteText] = useState('')
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [surface, setSurface] = useState<TextSurface | null>(null)
  const pdfMode = useSettings((s) => s.pdfMode)
  const setSettings = useSettings((s) => s.set)

  const resume = useResumeOffer(bookId)
  const { book, doc, file, error, index } = useBookLoader(bookId, resume.offer)
  const notes = useNotes(bookId, index)
  useReaderShortcuts(setPanel)

  const mode: 'text' | 'original' = doc?.type === 'pdf' ? pdfMode : 'text'
  const sync = useReaderSync(container, surface, index)
  const { highlighter } = sync
  const searchHit = useSearchHit(highlighter)

  useEffect(() => {
    setSurface(null)
  }, [mode])

  useEffect(() => {
    highlighter.setUserHighlights(notes.highlights)
  }, [highlighter, notes.highlights, surface])

  const closePanel = () => setPanel(null)

  const onHighlight = async (sel: SelectionInfo, color: HighlightColor, withNote: boolean) => {
    const row = await notes.highlightSelection(sel, color)
    if (row && withNote) {
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

  return (
    <div className="flex h-full flex-col bg-bg" data-testid="reader">
      <TopBar
        title={book?.title ?? ''}
        bookmarked={!!notes.bookmarkHere}
        onToggleBookmark={() => void notes.toggleBookmark()}
        onTextSettings={() => setPanel('text')}
        pdfMode={doc?.type === 'pdf' ? mode : undefined}
        onTogglePdfMode={() => setSettings({ pdfMode: mode === 'original' ? 'text' : 'original' })}
        menu={<ReaderMenu open={panel === 'menu'} onToggle={() => setPanel(panel === 'menu' ? null : 'menu')} onClose={closePanel} onSelect={setPanel} />}
      />
      {doc && <WhereBar doc={doc} index={index} viewBlock={sync.viewBlock} />}

      {/* body */}
      <div className="relative min-h-0 flex-1">
        {/* overflow-anchor: none — Lumen keeps the reading place itself (viewAnchor); the browser's own scroll
            anchoring would move the page behind its back while chapters settle */}
        <div ref={setContainer} className="h-full overflow-auto [overflow-anchor:none]" data-testid="reader-scroll" tabIndex={-1} onClick={sync.onTap}>
          {!doc || !index ? (
            <p className="p-8 text-center text-muted">Opening…</p>
          ) : mode === 'original' && file ? (
            <Suspense fallback={<p className="p-8 text-center text-muted">Loading pages…</p>}>
              <PdfView file={file} index={index} scrollEl={container} onSurface={setSurface} onUpdated={sync.onSurfaceUpdated} />
            </Suspense>
          ) : (
            <ReflowView index={index} titles={doc.sections.map((s) => s.title)} onSurface={setSurface} imagesFrom={doc.type === 'epub' ? bookId : undefined} />
          )}
        </div>

        {resume.resume && doc && (
          <ResumeBanner
            sectionTitle={resume.resume.sectionTitle}
            onContinue={resume.accept}
            onStartOver={() => {
              session().seekTo(0)
              sync.jumpToCurrent()
              resume.dismiss()
            }}
          />
        )}

        {sync.jumpVisible && (
          <div className="anim-fade pointer-events-none absolute right-4 bottom-4 left-20 z-10 flex justify-center">
            <div className="pointer-events-auto flex h-11 items-center overflow-hidden rounded-full border border-line bg-bg text-sm font-semibold text-fg shadow-[var(--shadow)]">
              <button onClick={sync.playFromView} data-testid="play-from-here" className="flex h-full items-center gap-1.5 pr-3 pl-4 hover:bg-surface">
                <Play size={15} fill="currentColor" className="text-primary" /> Play from here
              </button>
              <span className="h-5 w-px bg-line" aria-hidden />
              <button onClick={sync.jumpToCurrent} data-testid="jump-to-current" className="flex h-full items-center gap-1.5 pr-4 pl-3 hover:bg-surface">
                <Locate size={16} /> Jump to current
              </button>
            </div>
          </div>
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

      <PlayerBar onSpeed={() => setPanel('speed')} sectionLabel={doc?.type === 'pdf' ? 'page' : 'chapter'} doc={doc} index={index} />

      <SelectionToolbar container={container} surface={surface} index={index} onHighlight={(s, c, n) => void onHighlight(s, c, n)} onPlayFrom={(p) => sync.playFrom(p)} />

      <SpeedSheet open={panel === 'speed'} onClose={closePanel} />
      <TextSettingsSheet open={panel === 'text'} onClose={closePanel} />
      <SleepSheet open={panel === 'sleep'} onClose={closePanel} />
      {doc && <TocSheet open={panel === 'toc'} onClose={closePanel} doc={doc} index={index} />}
      {doc && (
        <SearchSheet
          open={panel === 'search'}
          onClose={() => {
            setPanel(null)
            searchHit.clear()
          }}
          index={index}
          doc={doc}
          onJump={(hit, play) => {
            searchHit.show(hit)
            jumpTo({ block: hit.block, offset: hit.start, section: hit.section }, play)
          }}
        />
      )}
      {doc && <NotesSheet open={panel === 'notes'} onClose={closePanel} bookmarks={notes.bookmarks} highlights={notes.highlights} doc={doc} onJump={(loc) => jumpTo(loc)} />}
      <NoteEditSheet
        open={panel === 'note-edit'}
        onClose={closePanel}
        highlight={noteFor}
        text={noteText}
        onTextChange={setNoteText}
        onSave={() => {
          if (noteFor) void updateHighlight(noteFor.id, { note: noteText.trim() })
          syncSoon()
          setPanel(null)
        }}
      />
    </div>
  )
}
