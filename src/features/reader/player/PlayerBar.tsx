import { useEffect, useState } from 'react'
import { ChevronsLeft, ChevronsRight, Loader2, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { session } from '@/session/session'
import { usePlayback } from '@/state/playback'
import { formatMinutes, formatTime, IconButton } from '@/ui/controls'
import { ModelProgress } from '@/features/voice/ModelProgress'

/** Bottom player: seekable progress, « play », chapter skip and the speed button. */
export function PlayerBar({ onSpeed, sectionLabel = 'chapter' }: { onSpeed: () => void; sectionLabel?: string }) {
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

  const s = session()
  const est = s.estimate()
  const frac = scrub ?? (est.total ? est.elapsed / est.total : 0)
  const playing = state === 'playing' || state === 'buffering'
  const elapsed = scrub !== null ? scrub * est.total : est.elapsed

  return (
    <div className="safe-bottom border-t border-line bg-bg" data-testid="player-bar">
      <ModelProgress />
      {error && state === 'error' && <p className="px-5 pt-2 text-sm text-red-600">Playback error: {error}</p>}
      <div className="px-5 pt-2">
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
