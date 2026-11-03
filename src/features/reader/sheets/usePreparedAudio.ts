import { useEffect, useMemo, useState } from 'react'
import { audioStore } from '@/data/audioCache'
import { session } from '@/session/session'
import type { BookIndex } from '@/engine/book/bookIndex'

/**
 * Which sentences of the open book already have audio for the current voice. One batched cache read when the sheet
 * opens, then kept up to date from the preparer's per-sentence events. `count(start, end)` is O(1) (prefix sums), so
 * every Contents row can ask without extra work.
 */
export function usePreparedAudio(bookId: string | null, index: BookIndex | null, open: boolean) {
  const [flags, setFlags] = useState<Uint8Array | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!open || !bookId || !index) return
    let alive = true
    let local: Uint8Array | null = null
    let frame = 0
    const bump = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setVersion((v) => v + 1)
      })
    }
    const pendingMarks: number[] = []
    const off = session().onPrepared((b, i) => {
      if (b !== bookId) return
      if (local) {
        local[i] = 1
        bump()
      } else pendingMarks.push(i)
    })
    const items = index.sentences.map((s, i) => ({ index: i, text: s.spoken.text }))
    void audioStore
      .lookup(bookId, items)
      .then(({ cached }) => {
        if (!alive) return
        local = new Uint8Array(index.sentences.length)
        cached.forEach((i) => (local![i] = 1))
        pendingMarks.forEach((i) => (local![i] = 1))
        setFlags(local)
        bump()
      })
      .catch(() => {})
    return () => {
      alive = false
      off()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [open, bookId, index])

  const prefix = useMemo(() => {
    void version
    if (!flags) return null
    const p = new Int32Array(flags.length + 1)
    for (let i = 0; i < flags.length; i++) p[i + 1] = p[i] + flags[i]
    return p
  }, [flags, version])

  return {
    known: !!prefix,
    /** sentences in start..end (inclusive) that have audio */
    count: (start: number, end: number) => (prefix && end >= start ? prefix[Math.min(end + 1, prefix.length - 1)] - prefix[start] : 0),
  }
}
