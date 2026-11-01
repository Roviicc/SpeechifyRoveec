import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function IconButton({ label, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-fg transition hover:bg-surface active:scale-95 disabled:opacity-40 ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: Array<{ value: T; label: ReactNode }>
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-full bg-surface p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-10 flex-1 rounded-full px-3 text-sm font-medium transition ${
            value === o.value ? 'bg-bg text-fg shadow-sm' : 'text-muted hover:text-fg'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label, description, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; testId?: string }) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center gap-3 py-2">
      <span className="flex-1">
        <span className="block text-[15px]">{label}</span>
        {description && <span className="block text-sm text-muted">{description}</span>}
      </span>
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span
        aria-hidden
        className="relative h-7 w-12 shrink-0 rounded-full bg-surface-2 transition peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-primary after:absolute after:top-1 after:left-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5"
      />
    </label>
  )
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  label,
  thin,
  testId,
  format,
}: {
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  label: string
  thin?: boolean
  testId?: string
  format?: (v: number) => string
}) {
  const fill = ((value - min) / (max - min)) * 100
  return (
    <input
      type="range"
      className={`slider ${thin ? 'thin' : ''}`}
      aria-label={label}
      aria-valuetext={format?.(value)}
      min={min}
      max={max}
      step={step}
      value={value}
      data-testid={testId}
      style={{ ['--fill' as string]: `${fill}%` }}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  )
}

export function Thumb({ cover, type, size = 48 }: { cover?: string; type: string; size?: number }) {
  return cover ? (
    <img src={cover} alt="" className="shrink-0 rounded-lg object-cover" style={{ width: size, height: size * 1.33 }} />
  ) : (
    <div
      className="grid shrink-0 place-items-center rounded-lg bg-primary-soft text-[10px] font-bold tracking-wide text-primary uppercase"
      style={{ width: size, height: size * 1.33 }}
    >
      {type}
    </div>
  )
}

export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  const s = Math.floor(sec % 60)
  const m = Math.floor((sec / 60) % 60)
  const h = Math.floor(sec / 3600)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

export function formatMinutes(sec: number): string {
  const m = Math.round(sec / 60)
  if (m < 1) return '< 1 min'
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}
