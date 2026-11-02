import { useCallback, useEffect, useRef } from 'react'
import type { TextPoint } from '@/features/reader/highlight/surface'

/** Two taps closer than this (ms, px) are a double tap. */
export const DOUBLE_TAP_MS = 250
const DOUBLE_TAP_PX = 40

type TapEvent = { target: EventTarget | null; clientX: number; clientY: number }

/**
 * Click handler for the reader body that tells a tap from a double tap.
 * - `enabled` false: every click is a tap right away (`tap`).
 * - `enabled` true (PDF Original): what a tap would jump to is read at once (`tapPoint`), but the jump (`jump`)
 *   waits out the double-tap window; a second tap nearby within it cancels the jump and calls `doubleTap`.
 * Clicks on controls (buttons, links, inputs) are never part of a double tap.
 */
export function useTapOrDoubleTap({
  enabled,
  tap,
  tapPoint,
  jump,
  doubleTap,
}: {
  enabled: boolean
  tap: (e: React.MouseEvent) => void
  tapPoint: (e: TapEvent) => TextPoint | null
  jump: (p: TextPoint) => void
  doubleTap: (x: number, y: number) => void
}) {
  const pending = useRef<{ at: number; x: number; y: number; timer?: ReturnType<typeof setTimeout> } | null>(null)
  const cancel = () => {
    clearTimeout(pending.current?.timer)
    pending.current = null
  }
  useEffect(() => cancel, [enabled])

  return useCallback(
    (e: React.MouseEvent) => {
      if (!enabled || (e.target as HTMLElement).closest('button, a, input')) return tap(e)
      const prev = pending.current
      const now = performance.now()
      if (prev && now - prev.at < DOUBLE_TAP_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_PX) {
        cancel()
        // a desktop double click also selects the word under it
        window.getSelection()?.removeAllRanges()
        doubleTap(e.clientX, e.clientY)
        return
      }
      cancel()
      const p = tapPoint(e)
      const next: { at: number; x: number; y: number; timer?: ReturnType<typeof setTimeout> } = { at: now, x: e.clientX, y: e.clientY }
      next.timer = setTimeout(() => {
        if (pending.current === next) pending.current = null
        if (p) jump(p)
      }, DOUBLE_TAP_MS)
      pending.current = next
    },
    [enabled, tap, tapPoint, jump, doubleTap],
  )
}
