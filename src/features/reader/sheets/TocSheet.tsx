import { useEffect, useMemo } from 'react'
import { Sheet } from '../../../ui/Sheet'
import { formatMinutes } from '../../../ui/controls'
import { session } from '../../../app/session'
import { usePlayback } from '../../../store/playback'
import { sectionEndSentence, type BookIndex } from '../../../engine/doc/bookIndex'
import type { BookDoc } from '../../../engine/doc/types'

export function TocSheet({ open, onClose, doc, index }: { open: boolean; onClose: () => void; doc: BookDoc; index: BookIndex | null }) {
  const section = usePlayback((s) => s.section)
  const speed = usePlayback((s) => s.speed)
  const current = useMemo(() => {
    let c = -1
    doc.toc.forEach((t, i) => {
      if (t.section <= section) c = i
    })
    return c
  }, [doc.toc, section])
  useEffect(() => {
    if (open) requestAnimationFrame(() => document.querySelector('[data-toc-current="true"]')?.scrollIntoView({ block: 'center' }))
  }, [open])
  const minutes = (sec: number) => {
    if (!index) return ''
    const start = index.sectionSentenceStart[sec]
    const end = sectionEndSentence(index, sec)
    if (start > end) return ''
    return formatMinutes(((index.cumChars[end + 1] - index.cumChars[start]) * session().secondsPerChar) / speed)
  }
  return (
    <Sheet open={open} onClose={onClose} title="Contents" testId="toc-sheet">
      <ul>
        {doc.toc.map((t, i) => (
          <li key={i}>
            <button
              data-toc-current={i === current}
              onClick={() => {
                const blockStart = index?.sectionBlockStart[t.section] ?? 0
                session().seekTo({ section: t.section, block: blockStart + (t.block ?? 0), offset: 0 })
                onClose()
              }}
              className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-surface ${i === current ? 'font-semibold text-primary' : ''}`}
              style={{ paddingLeft: 8 + t.level * 16 }}
            >
              <span className="flex-1 truncate">{t.title}</span>
              {t.level === 0 && <span className="shrink-0 text-xs text-muted">{minutes(t.section)}</span>}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}
