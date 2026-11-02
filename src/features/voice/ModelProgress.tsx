import { Download, Loader2 } from 'lucide-react'
import { usePlayback } from '@/state/playback'
import { session } from '@/session/session'
import { formatBytes } from '@/engine/voice/install'
import { VOICES } from './voiceInfo'

/**
 * Voice status above the player controls:
 * - first-time download: card with name, MB done / total, percentage and a progress bar ("one time only")
 * - loading from this device (or checking speed): one quiet line with a spinner, no bar
 * - error: message + Retry
 */
export function ModelProgress() {
  const model = usePlayback((s) => s.model)
  if (model.status !== 'downloading' && model.status !== 'loading' && model.status !== 'error') return null
  const name = model.voice ? VOICES[model.voice].name : ''
  if (model.status === 'error')
    return (
      <p className="px-5 pt-3 text-sm text-red-600" data-testid="model-progress" aria-live="polite">
        Couldn’t load the voice: {model.error}.{' '}
        <button className="font-semibold underline" onClick={() => void session().ensureModel()}>
          Retry
        </button>
      </p>
    )
  if (model.status === 'loading')
    return (
      <p className="flex items-center gap-2 px-5 pt-3 text-xs text-muted" data-testid="model-progress" aria-live="polite">
        <Loader2 size={14} className="animate-spin" />
        {model.fromDevice ? `Loading the ${name} voice…` : `Getting the ${name} voice ready…`}
      </p>
    )
  const pct = model.fraction !== null ? Math.round(model.fraction * 100) : null
  return (
    <div className="mx-4 mt-3 flex items-center gap-3 rounded-[16px] bg-surface p-3" data-testid="model-progress" aria-live="polite">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
        <Download size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex justify-between gap-2 text-sm">
          <span className="truncate font-semibold">Downloading the {name} voice</span>
          {pct !== null && <span className="tabular-nums">{pct}%</span>}
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className={`h-full rounded-full bg-primary transition-[width] ${pct === null ? 'w-1/3 animate-pulse' : ''}`} style={pct !== null ? { width: `${pct}%` } : undefined} />
        </div>
        <p className="mt-1 text-xs text-muted tabular-nums">
          {model.totalBytes ? `${formatBytes(model.loadedBytes)} of ${formatBytes(model.totalBytes)} · ` : ''}one time only
        </p>
      </div>
    </div>
  )
}
