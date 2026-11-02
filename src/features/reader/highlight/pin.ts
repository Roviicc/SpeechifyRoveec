/**
 * Place something in the reader and keep it pinned while the layout settles: long chapters finish laying out a
 * moment later (content-visibility renders off-screen sections lazily), which moves the content under a fixed
 * scrollTop (and images above load later still). Checks every frame for ~1.5 s and re-places whenever it drifted.
 * Stops at once when `cancelled()` says so or when anything else changes scrollTop — settling moves the content,
 * never scrollTop, so a changed scrollTop always means someone (the reader, another jump) moved the page.
 * Returns a function that stops pinning.
 */
export function pinWhileSettling(
  container: HTMLElement,
  place: () => void,
  misplaced: () => boolean,
  cancelled: () => boolean,
  done: () => void = () => {},
): () => void {
  let raf = 0
  let frames = 0
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    done()
  }
  place()
  let placedTop = container.scrollTop
  const tick = () => {
    raf = 0
    if (cancelled() || Math.abs(container.scrollTop - placedTop) > 1) return finish()
    if (misplaced()) {
      place()
      placedTop = container.scrollTop
    }
    if (++frames >= 90) return finish()
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return () => {
    cancelAnimationFrame(raf)
    finished = true
  }
}
