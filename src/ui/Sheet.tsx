import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface SheetProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  testId?: string
  /** extra element shown on the right of the title row */
  action?: ReactNode
  maxHeight?: string
}

const openSheets: Array<() => void> = []

/** Bottom sheet: backdrop, Esc / swipe-down to close, focus trap, restores focus. */
export function Sheet({ open, onClose, title, children, testId, action, maxHeight = '85vh' }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const drag = useRef<{ y: number; dy: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const close = () => closeRef.current()
    openSheets.push(close)
    const el = ref.current
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el
    first?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (openSheets[openSheets.length - 1] !== close) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
      } else if (e.key === 'Tab' && el) {
        const f = Array.from(el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(
          (n) => !n.hasAttribute('disabled'),
        )
        if (!f.length) return
        const a = f[0]
        const b = f[f.length - 1]
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault()
          b.focus()
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault()
          a.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      const i = openSheets.indexOf(close)
      if (i >= 0) openSheets.splice(i, 1)
      prev?.focus?.({ preventScroll: true })
    }
  }, [open])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" data-testid={testId}>
      <div className="anim-fade absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className="anim-sheet safe-bottom relative flex w-full max-w-xl flex-col rounded-t-[24px] bg-bg text-fg shadow-[var(--shadow)] outline-none"
        style={{ maxHeight }}
      >
        <div
          className="flex cursor-grab touch-none justify-center pt-2.5 pb-1"
          onPointerDown={(e) => {
            drag.current = { y: e.clientY, dy: 0 }
            ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            if (!drag.current || !ref.current) return
            drag.current.dy = Math.max(0, e.clientY - drag.current.y)
            ref.current.style.transform = `translateY(${drag.current.dy}px)`
          }}
          onPointerUp={() => {
            if (ref.current) ref.current.style.transform = ''
            if (drag.current && drag.current.dy > 80) onClose()
            drag.current = null
          }}
        >
          <div className="h-1.5 w-10 rounded-full bg-surface-2" />
        </div>
        {title !== undefined && (
          <div className="flex items-center gap-2 px-5 pt-1 pb-3">
            <h2 className="flex-1 text-lg font-bold">{title}</h2>
            {action}
            <button aria-label="Close" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full bg-surface text-fg hover:bg-surface-2" data-testid="sheet-close">
              <X size={20} />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
      </div>
    </div>
  )
}

/** True when any sheet is open (keyboard shortcuts are suspended). */
export function anySheetOpen() {
  return openSheets.length > 0
}
