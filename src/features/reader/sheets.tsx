import { useEffect, useMemo, useState } from 'react'
import { Bookmark, Moon, Play, Trash2 } from 'lucide-react'
import { Sheet } from '../../ui/Sheet'
import { formatMinutes, Segmented, Slider } from '../../ui/controls'
import { session } from '../../app/session'
import { usePlayback } from '../../store/playback'
import { useSettings, type FontFamily, type Margin, type Theme } from '../../store/settings'
import type { BookIndex } from '../../engine/doc/bookIndex'
import { sectionEndSentence } from '../../engine/doc/bookIndex'
import type { BookDoc } from '../../engine/doc/types'
import type { BookmarkRow, HighlightColor, HighlightRow } from '../../data/db'
import { deleteBookmark, deleteHighlight, updateHighlight } from '../../data/repo'

export const SPEED_PRESETS = [1, 1.5, 2, 2.5]

export function SpeedSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const speed = usePlayback((s) => s.speed)
  return (
    <Sheet open={open} onClose={onClose} title="Speed" testId="speed-sheet">
      <div className="py-2 text-center text-4xl font-bold tabular-nums" aria-live="polite" data-testid="speed-value">
        {speed.toFixed(1)}×
      </div>
      <div className="flex items-center gap-3 py-3">
        <span className="text-sm text-muted">0.5×</span>
        <Slider label="Speed" min={0.5} max={3} step={0.1} value={speed} onChange={(v) => session().setSpeed(v)} testId="speed-slider" format={(v) => `${v}x`} />
        <span className="text-sm text-muted">3×</span>
      </div>
      <div className="grid grid-cols-4 gap-2 pt-2">
        {SPEED_PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => session().setSpeed(p)}
            data-testid={`speed-preset-${p}`}
            className={`h-12 rounded-full text-[15px] font-semibold transition ${speed === p ? 'bg-primary text-on-primary' : 'bg-surface hover:bg-surface-2'}`}
          >
            {p}×
          </button>
        ))}
      </div>
    </Sheet>
  )
}

export function TextSettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const st = useSettings()
  return (
    <Sheet open={open} onClose={onClose} title="Text" testId="text-sheet">
      <div
        className="mb-4 rounded-[16px] bg-surface p-4"
        style={{
          fontSize: st.fontSize,
          lineHeight: st.lineHeight,
          fontFamily: st.fontFamily === 'serif' ? 'var(--font-serif)' : st.fontFamily === 'sans' ? 'var(--font-sans)' : 'var(--font-dyslexic)',
        }}
      >
        The quick brown fox jumps over the lazy dog.
      </div>
      <Row label={`Font size · ${st.fontSize}px`}>
        <div className="flex items-center gap-3">
          <span className="text-xs">A</span>
          <Slider label="Font size" min={12} max={32} step={1} value={st.fontSize} onChange={(v) => st.set({ fontSize: v })} testId="font-size" />
          <span className="text-xl">A</span>
        </div>
      </Row>
      <Row label="Font">
        <Segmented<FontFamily>
          label="Font family"
          value={st.fontFamily}
          onChange={(v) => st.set({ fontFamily: v })}
          options={[
            { value: 'serif', label: <span style={{ fontFamily: 'var(--font-serif)' }}>Serif</span> },
            { value: 'sans', label: 'Sans' },
            { value: 'dyslexic', label: <span style={{ fontFamily: 'var(--font-dyslexic)' }}>OpenDyslexic</span> },
          ]}
        />
      </Row>
      <Row label={`Line spacing · ${st.lineHeight.toFixed(1)}`}>
        <Slider label="Line spacing" min={1.2} max={2.2} step={0.1} value={st.lineHeight} onChange={(v) => st.set({ lineHeight: Math.round(v * 10) / 10 })} />
      </Row>
      <Row label="Margins">
        <Segmented<Margin>
          label="Margins"
          value={st.margin}
          onChange={(v) => st.set({ margin: v })}
          options={[
            { value: 'narrow', label: 'Narrow' },
            { value: 'normal', label: 'Normal' },
            { value: 'wide', label: 'Wide' },
          ]}
        />
      </Row>
      <Row label="Theme">
        <ThemePicker value={st.theme} onChange={(theme) => st.set({ theme })} />
      </Row>
    </Sheet>
  )
}

export function ThemePicker({ value, onChange }: { value: Theme; onChange: (t: Theme) => void }) {
  return (
    <Segmented<Theme>
      label="Theme"
      value={value}
      onChange={onChange}
      options={[
        { value: 'light', label: 'Light' },
        { value: 'sepia', label: 'Sepia' },
        { value: 'dark', label: 'Dark' },
        { value: 'system', label: 'System' },
      ]}
    />
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5">
      <div className="mb-1.5 text-sm font-medium text-muted">{label}</div>
      {children}
    </div>
  )
}

export function TocSheet({ open, onClose, doc, index }: { open: boolean; onClose: () => void; doc: BookDoc; index: BookIndex | null }) {
  const section = usePlayback((s) => s.section)
  const speed = usePlayback((s) => s.speed)
  const current = useMemo(() => {
    let c = -1
    doc.toc.forEach((t, i) => {
      if (t.section <= section) c = i
    })
    return c
  }, [doc.toc, section])
  useEffect(() => {
    if (open) requestAnimationFrame(() => document.querySelector('[data-toc-current="true"]')?.scrollIntoView({ block: 'center' }))
  }, [open])
  const minutes = (sec: number) => {
    if (!index) return ''
    const start = index.sectionSentenceStart[sec]
    const end = sectionEndSentence(index, sec)
    if (start > end) return ''
    return formatMinutes(((index.cumChars[end + 1] - index.cumChars[start]) * session().secondsPerChar) / speed)
  }
  return (
    <Sheet open={open} onClose={onClose} title="Contents" testId="toc-sheet">
      <ul>
        {doc.toc.map((t, i) => (
          <li key={i}>
            <button
              data-toc-current={i === current}
              onClick={() => {
                const blockStart = index?.sectionBlockStart[t.section] ?? 0
                session().seekTo({ section: t.section, block: blockStart + (t.block ?? 0), offset: 0 })
                onClose()
              }}
              className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-surface ${i === current ? 'font-semibold text-primary' : ''}`}
              style={{ paddingLeft: 8 + t.level * 16 }}
            >
              <span className="flex-1 truncate">{t.title}</span>
              {t.level === 0 && <span className="shrink-0 text-xs text-muted">{minutes(t.section)}</span>}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}

export function SleepSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sleep = usePlayback((s) => s.sleep)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!open) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [open])
  const opts: Array<{ v: 'off' | 'chapter' | number; label: string }> = [
    { v: 'off', label: 'Off' },
    { v: 15, label: '15 minutes' },
    { v: 30, label: '30 minutes' },
    { v: 45, label: '45 minutes' },
    { v: 60, label: '60 minutes' },
    { v: 'chapter', label: 'End of chapter' },
  ]
  const isActive = (v: 'off' | 'chapter' | number) =>
    (v === 'off' && sleep.mode === 'off') || (v === 'chapter' && sleep.mode === 'chapter') || (typeof v === 'number' && sleep.mode === 'minutes' && sleep.minutes === v)
  return (
    <Sheet open={open} onClose={onClose} title="Sleep timer" testId="sleep-sheet">
      {sleep.mode === 'minutes' && sleep.endsAt && (
        <p className="mb-2 flex items-center gap-2 text-sm text-muted">
          <Moon size={16} /> Stops in {formatMinutes((sleep.endsAt - Date.now()) / 1000)} with a gentle fade-out
        </p>
      )}
      {opts.map((o) => (
        <button
          key={String(o.v)}
          onClick={() => {
            session().setSleep(o.v)
            onClose()
          }}
          className={`flex min-h-12 w-full items-center rounded-xl px-3 text-left hover:bg-surface ${isActive(o.v) ? 'font-semibold text-primary' : ''}`}
        >
          {o.label}
        </button>
      ))}
    </Sheet>
  )
}

interface SearchHit {
  block: number
  start: number
  end: number
  section: number
}

export function SearchSheet({
  open,
  onClose,
  index,
  doc,
  onJump,
}: {
  open: boolean
  onClose: () => void
  index: BookIndex | null
  doc: BookDoc
  onJump: (hit: SearchHit, play: boolean) => void
}) {
  const [q, setQ] = useState('')
  const results = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!index || query.length < 2) return []
    const out: SearchHit[] = []
    for (const b of index.blocks) {
      const t = b.text.toLowerCase()
      let from = 0
      let k: number
      while ((k = t.indexOf(query, from)) >= 0) {
        out.push({ block: b.index, start: k, end: k + query.length, section: b.section })
        from = k + query.length
        if (out.length >= 300) return out
      }
    }
    return out
  }, [q, index])
  return (
    <Sheet open={open} onClose={onClose} title="Search in book" testId="search-sheet" maxHeight="90vh">
      <input
        data-autofocus
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search words or phrases"
        aria-label="Search in book"
        data-testid="search-input"
        className="mb-3 h-12 w-full rounded-full bg-surface px-5 text-[15px] outline-none focus:ring-2 focus:ring-primary"
      />
      {q.trim().length >= 2 && (
        <p className="mb-2 text-sm text-muted" aria-live="polite">
          {results.length >= 300 ? '300+' : results.length} results
        </p>
      )}
      <ul>
        {results.map((r, i) => {
          const text = index!.blocks[r.block].text
          const a = Math.max(0, r.start - 50)
          const b = Math.min(text.length, r.end + 70)
          return (
            <li key={i} className="flex items-start gap-1 border-b border-line">
              <button className="flex-1 py-3 text-left" onClick={() => onJump(r, false)} data-testid="search-result">
                <span className="block text-xs text-muted">{doc.sections[r.section]?.title}</span>
                <span className="text-[15px]">
                  {a > 0 && '…'}
                  {text.slice(a, r.start)}
                  <mark className="rounded bg-yellow-300/70 px-0.5 text-inherit">{text.slice(r.start, r.end)}</mark>
                  {text.slice(r.end, b)}
                  {b < text.length && '…'}
                </span>
              </button>
              <button aria-label="Start reading here" className="mt-2 grid h-10 w-10 shrink-0 place-items-center rounded-full text-primary hover:bg-surface" onClick={() => onJump(r, true)}>
                <Play size={18} fill="currentColor" />
              </button>
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
}

export const HIGHLIGHT_COLORS: Array<{ color: HighlightColor; css: string }> = [
  { color: 'yellow', css: 'rgb(250 204 21)' },
  { color: 'green', css: 'rgb(74 222 128)' },
  { color: 'blue', css: 'rgb(96 165 250)' },
  { color: 'pink', css: 'rgb(244 114 182)' },
]

export function NotesSheet({
  open,
  onClose,
  bookmarks,
  highlights,
  doc,
  onJump,
}: {
  open: boolean
  onClose: () => void
  bookmarks: BookmarkRow[]
  highlights: HighlightRow[]
  doc: BookDoc
  onJump: (loc: { section: number; block: number; offset: number }) => void
}) {
  const [tab, setTab] = useState<'bookmarks' | 'highlights'>('bookmarks')
  const [editing, setEditing] = useState<string | null>(null)
  const [note, setNote] = useState('')
  return (
    <Sheet open={open} onClose={onClose} title="Notes & Bookmarks" testId="notes-sheet" maxHeight="90vh">
      <div className="mb-3">
        <Segmented
          label="Show"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'bookmarks', label: `Bookmarks (${bookmarks.length})` },
            { value: 'highlights', label: `Highlights (${highlights.length})` },
          ]}
        />
      </div>
      {tab === 'bookmarks' ? (
        bookmarks.length ? (
          <ul>
            {bookmarks.map((b) => (
              <li key={b.id} className="flex items-center gap-2 border-b border-line" data-testid="bookmark-item">
                <Bookmark size={18} className="shrink-0 text-primary" fill="currentColor" />
                <button className="min-w-0 flex-1 py-3 text-left" onClick={() => onJump(b.locator)}>
                  <span className="block text-xs text-muted">{doc.sections[b.locator.section]?.title}</span>
                  <span className="line-clamp-2 text-[15px]">{b.label}</span>
                </button>
                <button aria-label="Delete bookmark" className="grid h-10 w-10 place-items-center rounded-full text-muted hover:bg-surface" onClick={() => void deleteBookmark(b.id)}>
                  <Trash2 size={18} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-8 text-center text-muted">No bookmarks yet. Tap the bookmark icon at the top while reading.</p>
        )
      ) : highlights.length ? (
        <ul>
          {highlights.map((h) => (
            <li key={h.id} className="border-b border-line py-2" data-testid="highlight-item">
              <div className="flex items-start gap-2">
                <span className="mt-1.5 h-3 w-3 shrink-0 rounded-full" style={{ background: HIGHLIGHT_COLORS.find((c) => c.color === h.color)?.css }} />
                <button className="min-w-0 flex-1 text-left" onClick={() => onJump(h.start)}>
                  <span className="block text-xs text-muted">{doc.sections[h.start.section]?.title}</span>
                  <span className="line-clamp-3 text-[15px]">“{h.text}”</span>
                  {h.note && editing !== h.id && <span className="mt-1 block text-sm text-muted italic">{h.note}</span>}
                </button>
                <button aria-label="Delete highlight" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted hover:bg-surface" onClick={() => void deleteHighlight(h.id)}>
                  <Trash2 size={18} />
                </button>
              </div>
              {editing === h.id ? (
                <div className="mt-2 flex gap-2 pl-5">
                  <input
                    value={note}
                    autoFocus
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Add a note"
                    aria-label="Note"
                    className="h-10 flex-1 rounded-full bg-surface px-4 text-sm outline-none focus:ring-2 focus:ring-primary"
                  />
                  <button
                    className="h-10 rounded-full bg-primary px-4 text-sm font-semibold text-on-primary"
                    onClick={() => {
                      void updateHighlight(h.id, { note })
                      setEditing(null)
                    }}
                  >
                    Save
                  </button>
                </div>
              ) : (
                <div className="mt-1 flex items-center gap-1 pl-5">
                  {HIGHLIGHT_COLORS.map((c) => (
                    <button
                      key={c.color}
                      aria-label={`Color ${c.color}`}
                      onClick={() => void updateHighlight(h.id, { color: c.color })}
                      className={`grid h-8 w-8 place-items-center rounded-full ${h.color === c.color ? 'ring-2 ring-fg/40' : ''}`}
                    >
                      <span className="h-4 w-4 rounded-full" style={{ background: c.css }} />
                    </button>
                  ))}
                  <button
                    className="ml-1 h-8 rounded-full px-3 text-sm text-primary hover:bg-surface"
                    onClick={() => {
                      setNote(h.note)
                      setEditing(h.id)
                    }}
                  >
                    {h.note ? 'Edit note' : 'Add note'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-8 text-center text-muted">No highlights yet. Select text (long-press on a phone) to highlight it.</p>
      )}
    </Sheet>
  )
}
