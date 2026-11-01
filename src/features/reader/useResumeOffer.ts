import { useEffect, useState } from 'react'
import { session } from '../../app/session'
import { usePlayback } from '../../store/playback'
import type { ProgressRow } from '../../data/db'
import { getProgress } from '../../data/repo'
import { onRemoteProgress } from '../../sync/syncService'

/**
 * The "Continue from …?" offer: set when a book opens with saved progress or when progress for
 * this book arrives from another device; cleared as soon as playback starts.
 */
export function useResumeOffer(bookId: string) {
  const [resume, setResume] = useState<ProgressRow | null>(null)
  const state = usePlayback((s) => s.state)

  useEffect(() => {
    if (state === 'playing') setResume(null)
  }, [state])

  // progress synced from another device: offer to continue there
  useEffect(() => {
    const off = onRemoteProgress(async (ids) => {
      if (!ids.includes(bookId) || session().player.isActive) return
      const p = await getProgress(bookId)
      if (p && p.sentence !== session().player.index) setResume(p)
    })
    return () => {
      off()
    }
  }, [bookId])

  /** Continue from the offered position (or just play if we are already there). */
  const accept = () => {
    if (resume && resume.sentence !== session().player.index) session().seekTo(resume.locator, true)
    else session().play()
    setResume(null)
  }

  return { resume, offer: setResume, accept, dismiss: () => setResume(null) }
}
