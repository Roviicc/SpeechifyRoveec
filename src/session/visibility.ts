/** Sentences generated ahead while the app is visible / hidden (screen locked, in the background). */
export const PREFETCH_VISIBLE = 3
export const PREFETCH_HIDDEN = 8

export function prefetchDepth(hidden: boolean): number {
  return hidden ? PREFETCH_HIDDEN : PREFETCH_VISIBLE
}

/** Calls `fn(hidden)` on every visibility change, and once right away if the page starts hidden. */
export function watchVisibility(fn: (hidden: boolean) => void): () => void {
  if (typeof document === 'undefined') return () => {}
  const onChange = () => fn(document.visibilityState === 'hidden')
  document.addEventListener('visibilitychange', onChange)
  if (document.visibilityState === 'hidden') onChange()
  return () => document.removeEventListener('visibilitychange', onChange)
}
