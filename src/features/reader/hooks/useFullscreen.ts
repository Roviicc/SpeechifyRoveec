import { useCallback, useEffect, useState } from 'react'

/**
 * Full-screen reading: hides Lumen's bars (top bar, where-am-I line, player) and, where the browser allows it, the
 * phone's own status and navigation bars too. Leaving it — the button, Android's back gesture, Esc — brings back
 * everything as it was.
 */
export function useFullscreen() {
  const [on, setOn] = useState(false)

  const enter = useCallback(() => {
    setOn(true)
    // best effort: not every browser (or an iPhone) lets a page hide the system bars
    document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {})
  }, [])

  const exit = useCallback(() => {
    setOn(false)
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
  }, [])

  // the system left full screen by itself (back gesture, Esc): show the bars again
  useEffect(() => {
    let was = !!document.fullscreenElement
    const onChange = () => {
      const now = !!document.fullscreenElement
      if (was && !now) setOn(false)
      was = now
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // leaving the book never leaves the app stuck in full screen
  useEffect(() => () => void (document.fullscreenElement && document.exitFullscreen?.().catch(() => {})), [])

  return { on, toggle: on ? exit : enter, exit }
}
