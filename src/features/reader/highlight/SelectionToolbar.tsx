import { BookOpenText, Copy, Play, StickyNote } from 'lucide-react'
import type { BookIndex } from '@/engine/book/bookIndex'
import { toast } from '@/ui/toast'
import { useReaderSelection, type SelectionInfo } from './useReaderSelection'

export type { SelectionInfo } from './useReaderSelection'
import { useSettings } from '@/state/settings'
import { lookUp } from '@/features/reader/lookup'
import type { TextPoint, TextSurface } from './surface'
import { HIGHLIGHT_COLORS } from '@/features/reader/sheets/constants'
import type { HighlightColor } from '@/data/db'

/** Floating toolbar shown over a text selection: 4 highlight colours, note, copy, look up, play from here. */
export function SelectionToolbar({
  container,
  surface,
  index,
  onHighlight,
  onPlayFrom,
}: {
  container: HTMLElement | null
  surface: TextSurface | null
  index: BookIndex | null
  onHighlight: (sel: SelectionInfo, color: HighlightColor, withNote: boolean) => void
  onPlayFrom: (p: TextPoint) => void
}) {
  const { sel, clear } = useReaderSelection(container, surface, index)
  const lookupApp = useSettings((s) => s.lookup)
  if (!sel) return null
  const top = Math.max(64, sel.rect.top - 60)
  const left = Math.min(Math.max(8, sel.rect.left + sel.rect.width / 2 - 170), window.innerWidth - 348)
  const done = clear
  return (
    <div
      className="anim-fade fixed z-40 flex h-12 items-center gap-1 rounded-full bg-fg px-2 text-bg shadow-[var(--shadow)]"
      style={{ top, left }}
      data-testid="selection-toolbar"
      onMouseDown={(e) => e.preventDefault()}
    >
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c.color}
          aria-label={`Highlight ${c.color}`}
          data-testid={`hl-${c.color}`}
          className="grid h-10 w-10 place-items-center rounded-full"
          onClick={() => {
            onHighlight(sel, c.color, false)
            done()
          }}
        >
          <span className="h-6 w-6 rounded-full border-2 border-bg/40" style={{ background: c.css }} />
        </button>
      ))}
      <button
        aria-label="Highlight with note"
        className="grid h-10 w-10 place-items-center rounded-full"
        onClick={() => {
          onHighlight(sel, 'yellow', true)
          done()
        }}
      >
        <StickyNote size={20} />
      </button>
      <button
        aria-label="Copy"
        data-testid="copy"
        className="grid h-10 w-10 place-items-center rounded-full"
        onClick={() => {
          void navigator.clipboard?.writeText(sel.text).then(() => toast('Copied'))
          done()
        }}
      >
        <Copy size={19} />
      </button>
      <button
        aria-label="Look up"
        data-testid="lookup"
        className="grid h-10 w-10 place-items-center rounded-full"
        onClick={() => {
          void lookUp(sel.text, lookupApp)
          done()
        }}
      >
        <BookOpenText size={20} />
      </button>
      <button
        aria-label="Play from here"
        className="grid h-10 w-10 place-items-center rounded-full"
        onClick={() => {
          onPlayFrom(sel.start)
          done()
        }}
      >
        <Play size={20} fill="currentColor" />
      </button>
    </div>
  )
}
