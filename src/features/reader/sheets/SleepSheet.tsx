import { useEffect, useState } from 'react'
import { Moon } from 'lucide-react'
import { Sheet } from '@/ui/Sheet'
import { formatMinutes } from '@/ui/controls'
import { session } from '@/session/session'
import { usePlayback } from '@/state/playback'

type SleepChoice = 'off' | 'chapter' | number

const OPTIONS: Array<{ v: SleepChoice; label: string }> = [
  { v: 'off', label: 'Off' },
  { v: 15, label: '15 minutes' },
  { v: 30, label: '30 minutes' },
  { v: 45, label: '45 minutes' },
  { v: 60, label: '60 minutes' },
  { v: 'chapter', label: 'End of chapter' },
]

export function SleepSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sleep = usePlayback((s) => s.sleep)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!open) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [open])
  const isActive = (v: SleepChoice) =>
    (v === 'off' && sleep.mode === 'off') || (v === 'chapter' && sleep.mode === 'chapter') || (typeof v === 'number' && sleep.mode === 'minutes' && sleep.minutes === v)
  return (
    <Sheet open={open} onClose={onClose} title="Sleep timer" testId="sleep-sheet">
      {sleep.mode === 'minutes' && sleep.endsAt && (
        <p className="mb-2 flex items-center gap-2 text-sm text-muted">
          <Moon size={16} /> Stops in {formatMinutes((sleep.endsAt - Date.now()) / 1000)} with a gentle fade-out
        </p>
      )}
      {OPTIONS.map((o) => (
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
