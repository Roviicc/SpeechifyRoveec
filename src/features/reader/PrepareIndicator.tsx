import { usePrepare } from '@/state/prepare'
import { ProgressRing } from '@/ui/controls'

/** Small "preparing audio" mark (ring + percent), shown while chapters are generated ahead, wherever the user is. */
export function PrepareIndicator({ className = '' }: { className?: string }) {
  const current = usePrepare((s) => s.current)
  if (!current) return null
  const pct = current.total ? Math.round((current.done / current.total) * 100) : 0
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 text-xs text-muted tabular-nums ${className}`}
      role="status"
      aria-label={`Preparing audio: ${current.job.label}, ${pct}%`}
      title={`Preparing audio: ${current.job.label}`}
      data-testid="prepare-indicator"
    >
      <ProgressRing fraction={current.total ? current.done / current.total : 0} size={14} />
      {pct}%
    </span>
  )
}
