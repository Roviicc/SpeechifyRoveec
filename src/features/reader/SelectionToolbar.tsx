import { useEffect, useState } from 'react'
import { Play, StickyNote } from 'lucide-react'
import type { TextPoint, TextSurface } from './surface'
import { HIGHLIGHT_COLORS } from './sheets/constants'
import type { HighlightColor } from '../../data/db'

export interface SelectionInfo {
  start: TextPoint
  end: TextPoint
  text: string
  rect: DOMRect
}

/** Floating toolbar shown over a text selection: 4 highlight colours, note, play from here. */
export function SelectionToolbar({
  container,
  surface,
  onHighlight,
  onPlayFrom,
}: {
  container: HTMLElement | null
  surface: TextSurface | null
  onHighlight: (sel: SelectionInfo, color: HighlightColor, withNote: boolean) => void
  onPlayFrom: (p: TextPoint) => void
}) {
  const [sel, setSel] = useState<SelectionInfo | null>(null)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const update = () => {
      clearTimeout(t)
      t = setTimeout(() => {
        const s = window.getSelection()
        if (!s || s.isCollapsed || !s.rangeCount || !container || !surface) return setSel(null)
        const r = s.getRangeAt(0)
        if (!container.contains(r.commonAncestorContainer)) return setSel(null)
        const a = surface.locate(r.startContainer, r.startOffset)
        const b = surface.locate(r.endContainer, r.endOffset)
        const text = r.toString().replace(/\s+/g, ' ').trim()
        if (!a || !b || !text) return setSel(null)
        const [start, end] = a.block < b.block || (a.block === b.block && a.offset <= b.offset) ? [a, b] : [b, a]
        setSel({ start, end, text, rect: r.getBoundingClientRect() })
      }, 120)
    }
    document.addEventListener('selectionchange', update)
    return () => {
      clearTimeout(t)
      document.removeEventListener('selectionchange', update)
    }
  }, [container, surface])
  if (!sel) return null
  const top = Math.max(64, sel.rect.top - 60)
  const left = Math.min(Math.max(8, sel.rect.left + sel.rect.width / 2 - 130), window.innerWidth - 268)
  const done = () => {
    window.getSelection()?.removeAllRanges()
    setSel(null)
  }
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
