import { useEffect, type Dispatch, type SetStateAction } from 'react'
import { session } from '@/session/session'
import { anySheetOpen } from '@/ui/Sheet'
import type { Panel } from '@/features/reader/panels'

/**
 * Desktop keyboard shortcuts: Space play/pause, ←/→ sentence (with Shift: chapter), +/- speed,
 * Esc closes the open panel. Ignored while typing or while a sheet is open.
 */
export function useReaderShortcuts(setPanel: Dispatch<SetStateAction<Panel>>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]') || anySheetOpen()) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const s = session()
      switch (e.key) {
        case ' ':
          e.preventDefault()
          s.toggle()
          break
        case 'ArrowRight':
          e.preventDefault()
          if (e.shiftKey) s.nextSection(1)
          else s.player.next()
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (e.shiftKey) s.nextSection(-1)
          else s.player.prev()
          break
        case '+':
        case '=':
          s.setSpeed(s.player.speed + 0.1)
          break
        case '-':
        case '_':
          s.setSpeed(s.player.speed - 0.1)
          break
        case 'Escape':
          setPanel(null)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPanel])
}
