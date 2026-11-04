import { Loader2, Pause, Play } from 'lucide-react'
import { session } from '@/session/session'
import { usePlayback } from '@/state/playback'

/** Full screen hides the player bar; this round button keeps play / pause within reach. */
export function FloatingPlayButton({ className = '' }: { className?: string }) {
  const state = usePlayback((s) => s.state)
  const playing = state === 'playing' || state === 'buffering'
  return (
    <button
      type="button"
      aria-label={playing ? 'Pause' : 'Play'}
      data-testid="fullscreen-play-pause"
      data-state={state}
      onClick={() => session().toggle()}
      className={`grid h-14 w-14 place-items-center rounded-full bg-primary text-on-primary shadow-lg transition hover:brightness-110 active:scale-95 ${className}`}
    >
      {state === 'buffering' ? <Loader2 size={26} className="animate-spin" /> : playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" className="ml-1" />}
    </button>
  )
}
