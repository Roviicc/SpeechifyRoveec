import { Sheet } from '../../../ui/Sheet'
import { Slider } from '../../../ui/controls'
import { session } from '../../../app/session'
import { usePlayback } from '../../../store/playback'
import { SPEED_PRESETS } from './constants'

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
