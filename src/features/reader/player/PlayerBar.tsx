import { useEffect, useMemo, useState } from 'react'
import type { BookIndex } from '@/engine/book/bookIndex'
import type { BookDoc } from '@/engine/book/types'
import { whereLabel } from '@/features/reader/WhereBar'
import { ChevronsLeft, ChevronsRight, Loader2, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { session } from '@/session/session'
import { usePlayback } from '@/state/playback'
import { formatMinutes, formatTime, IconButton } from '@/ui/controls'
import { ModelProgress } from '@/features/voice/ModelProgress'

/** Bottom player: seekable progress, « play », chapter skip and the speed button. */
export function PlayerBar({
  onSpeed,
  sectionLabel = 'chapter',
  doc,
  index: book,
}: {
  onSpeed: () => void
  sectionLabel?: string
  doc?: BookDoc | null
  index?: BookIndex | null
}) {
  const state = usePlayback((s) => s.state)
  const speed = usePlayback((s) => s.speed)
  const index = usePlayback((s) => s.index)
  const error = usePlayback((s) => s.error)
  const [, force] = useState(0)
  const [scrub, setScrub] = useState<number | null>(null)

  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 500)
    return () => clearInterval(t)
  }, [])

  // chapter starts as fractions of the book (top-level contents entries; none for page-by-page PDF lists)
  const ticks = useMemo(() => {
    if (!doc || !book || !book.totalChars) return []
    const entries = doc.toc.filter((t) => t.level === 0)
    if (entries.length < 2 || entries.length > 80) return []
    return entries
      .map((t) => {
        const first = book.sectionSentenceStart[t.section]
        return first === undefined ? -1 : book.cumChars[first] / book.totalChars
      })
      .filter((f) => f > 0.002 && f < 0.998)
  }, [doc, book])

  const s = session()
  const est = s.estimate()
  const frac = scrub ?? (est.total ? est.elapsed / est.total : 0)
  const playing = state === 'playing' || state === 'buffering'
  const elapsed = scrub !== null ? scrub * est.total : est.elapsed

  return (
    <div className="safe-bottom border-t border-line bg-bg" data-testid="player-bar">
      <ModelProgress />
      {error && state === 'error' && <p className="px-5 pt-2 text-sm text-red-600">Playback error: {error}</p>}
      <div className="relative px-5 pt-2">
        {scrub !== null && doc && book && (
          <ScrubBubble fraction={scrub} label={(() => {
            const i = s.sentenceAtFraction(scrub)
            const block = book.sentences[i]?.block
            return block === undefined ? '' : whereLabel(doc, book, block).primary
          })()} time={formatTime(scrub * est.total)} />
        )}
        <input
          type="range"
          className="slider thin"
          aria-label="Position in book"
          min={0}
          max={1000}
          value={Math.round(frac * 1000)}
          data-testid="progress"
          style={{ ['--fill' as string]: `${frac * 100}%` }}
          onChange={(e) => setScrub(Number(e.target.value) / 1000)}
          onPointerUp={() => {
            if (scrub !== null) s.seekTo(s.sentenceAtFraction(scrub))
            setScrub(null)
          }}
          onKeyUp={() => {
            if (scrub !== null) s.seekTo(s.sentenceAtFraction(scrub))
            setScrub(null)
          }}
        />
        <div className="pointer-events-none absolute inset-x-5 top-2 h-7" aria-hidden data-testid="chapter-ticks">
          {ticks.map((f, k) => (
            <span key={k} className="absolute top-1/2 h-2 w-[3px] -translate-x-1/2 -translate-y-1/2 bg-bg" style={{ left: `${f * 100}%` }} />
          ))}
        </div>
        <div className="-mt-1 flex justify-between text-xs text-muted tabular-nums">
          <span data-testid="elapsed">{formatTime(elapsed)}</span>
          <span className="truncate px-2">{est.sectionRemaining > 0 ? `${formatMinutes(est.sectionRemaining)} left in ${sectionLabel}` : ''}</span>
          <span data-testid="remaining">-{formatTime(est.total - elapsed)}</span>
        </div>
      </div>
      <div className="relative flex items-center justify-center gap-1.5 px-4 pt-1 pb-3 sm:gap-3">
        <IconButton label={`Previous ${sectionLabel}`} onClick={() => s.nextSection(-1)} className="h-10 w-10 text-muted max-[370px]:hidden">
          <SkipBack size={20} />
        </IconButton>
        <IconButton label="Previous sentence" onClick={() => s.player.prev()} data-testid="prev-sentence" disabled={index <= 0 && s.player.currentTime < 1.5}>
          <ChevronsLeft size={28} />
        </IconButton>
        <button
          type="button"
          aria-label={playing ? 'Pause' : 'Play'}
          data-testid="play-pause"
          data-state={state}
          onClick={() => s.toggle()}
          className="grid h-16 w-16 place-items-center rounded-full bg-primary text-on-primary shadow-lg transition hover:brightness-110 active:scale-95"
        >
          {state === 'buffering' ? <Loader2 size={30} className="animate-spin" /> : playing ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" className="ml-1" />}
        </button>
        <IconButton label="Next sentence" onClick={() => s.player.next()} data-testid="next-sentence">
          <ChevronsRight size={28} />
        </IconButton>
        <IconButton label={`Next ${sectionLabel}`} onClick={() => s.nextSection(1)} className="h-10 w-10 text-muted max-[370px]:hidden">
          <SkipForward size={20} />
        </IconButton>
        <button
          type="button"
          onClick={onSpeed}
          aria-label={`Playback speed ${speed}x`}
          data-testid="speed-button"
          className="absolute right-4 grid h-12 w-12 place-items-center rounded-full border-2 border-line text-sm font-bold tabular-nums hover:bg-surface"
        >
          {speed}×
        </button>
      </div>
    </div>
  )
}

/** Bubble above the progress bar while dragging: where you would land. */
function ScrubBubble({ fraction, label, time }: { fraction: number; label: string; time: string }) {
  return (
    <div
      className="pointer-events-none absolute bottom-full z-10 mb-1 max-w-[70%] -translate-x-1/2 rounded-xl border border-line bg-bg px-3 py-1.5 text-center shadow-[var(--shadow)]"
      style={{ left: `clamp(25%, calc(20px + ${fraction} * (100% - 40px)), 75%)` }}
      data-testid="scrub-bubble"
    >
      <div className="truncate text-xs font-semibold">{label}</div>
      <div className="text-[11px] text-muted tabular-nums">{time}</div>
    </div>
  )
}
