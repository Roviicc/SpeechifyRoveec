import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { session } from '@/session/session'
import { navigate } from '@/app/router'
import type { BookDoc } from '@/engine/book/types'
import type { BookIndex } from '@/engine/book/bookIndex'
import { usePlayback } from '@/state/playback'
import { IconButton } from '@/ui/controls'
import { PlayerBar } from '@/features/reader/player/PlayerBar'
import { ReflowView } from '@/features/reader/views/ReflowView'
import { SpeedSheet } from '@/features/reader/sheets'
import { useReaderSync } from '@/features/reader/highlight/useReaderSync'
import type { TextSurface } from '@/features/reader/highlight/surface'

const SAMPLE = `Dr. Smith arrived at 3.14 p.m. on a grey Tuesday. The lab smelled of coffee and solder; nobody had slept. "Is it working?" she asked, setting down a box of parts [12].

Kokoro is a small text-to-speech model with 82 million parameters. It runs entirely in your browser, so your books never leave your device (see https://example.com/kokoro for details). Tap any word to jump there, and change the speed at any time.`

function textDoc(text: string): BookDoc {
  const paras = text.split(/\n\s*\n/).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean)
  return { version: 1, type: 'epub', title: 'Voice test', sections: [{ title: 'Pasted text', blocks: paras.map((p) => ({ text: p, kind: 'p' })) }], toc: [] }
}

/** Phase-1 test page: paste text, play with sentence + word highlighting, tap-to-jump, speed. */
export function VoiceTestScreen() {
  const [text, setText] = useState(SAMPLE)
  const [index, setIndex] = useState<BookIndex | null>(null)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [surface, setSurface] = useState<TextSurface | null>(null)
  const [speedOpen, setSpeedOpen] = useState(false)
  const rtf = usePlayback((s) => s.rtf)
  const device = usePlayback((s) => s.device)
  const sync = useReaderSync(container, surface, index)

  const load = useCallback((t: string, autoplay: boolean) => {
    session().open({ id: `scratch-${hash(t)}`, title: 'Voice test', doc: textDoc(t), persist: false })
    if (autoplay) session().play()
  }, [])

  useEffect(() => {
    const off = session().onIndex(setIndex)
    if (!session().book?.id.startsWith('scratch-')) load(SAMPLE, false)
    return off
  }, [load])

  return (
    <div className="flex h-full flex-col" data-testid="tts-test">
      <header className="safe-top flex h-14 shrink-0 items-center gap-1 border-b border-line px-2">
        <IconButton label="Back" onClick={() => navigate({ name: 'settings' })}>
          <ChevronLeft size={24} />
        </IconButton>
        <h1 className="flex-1 text-[17px] font-semibold">Voice test</h1>
        <span className="pr-3 text-xs text-muted tabular-nums" data-testid="rtf">
          {device ?? '—'} · RTF {rtf ? rtf.toFixed(2) : '—'}
        </span>
      </header>
      <div className="shrink-0 border-b border-line p-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          aria-label="Text to read"
          data-testid="tts-input"
          className="w-full rounded-[16px] bg-surface p-3 text-[15px] outline-none focus:ring-2 focus:ring-primary"
        />
        <button className="mt-2 h-11 w-full rounded-full bg-primary font-semibold text-on-primary" onClick={() => load(text, true)} data-testid="tts-read">
          Read this text
        </button>
      </div>
      <div ref={setContainer} className="relative min-h-0 flex-1 overflow-auto" onClick={sync.onTap} data-testid="reader-scroll">
        {index && <ReflowView index={index} titles={['Pasted text']} onSurface={setSurface} />}
      </div>
      <PlayerBar onSpeed={() => setSpeedOpen(true)} sectionLabel="text" />
      <SpeedSheet open={speedOpen} onClose={() => setSpeedOpen(false)} />
    </div>
  )
}

function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}
