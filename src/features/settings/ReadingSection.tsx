import { useSettings } from '@/state/settings'
import { useState } from 'react'
import { BookOpenText, Check, ChevronRight } from 'lucide-react'
import { Segmented, Toggle } from '@/ui/controls'
import { Sheet } from '@/ui/Sheet'
import { LOOKUP_APPS, lookUp, lookupAppName } from '@/features/reader/lookup'
import { Group } from './Group'

export function ReadingSection() {
  const st = useSettings()
  const [picking, setPicking] = useState(false)
  return (
    <Group title="Reading">
      <Toggle label="Highlight current sentence" checked={st.highlightSentence} onChange={(v) => st.set({ highlightSentence: v })} testId="toggle-hl-sentence" />
      <Toggle label="Highlight current word" checked={st.highlightWord} onChange={(v) => st.set({ highlightWord: v })} testId="toggle-hl-word" />
      <Toggle label="Auto-scroll" description="Keep the sentence being read in view" checked={st.autoScroll} onChange={(v) => st.set({ autoScroll: v })} />
      <div className="border-t border-line py-3">
        <div className="mb-1.5 text-[15px]">Text selection on phones</div>
        <Segmented<'android' | 'lumen'>
          label="Text selection on phones"
          value={st.touchSelection}
          onChange={(v) => st.set({ touchSelection: v })}
          options={[
            { value: 'android', label: 'Android' },
            { value: 'lumen', label: 'Lumen' },
          ]}
        />
        <p className="mt-1.5 text-sm text-muted" data-testid="selection-mode-note">
          {st.touchSelection === 'android'
            ? 'Android’s handles and menu. Apps like ColorDict appear in that menu (under ⋮) and open as a popup over the book.'
            : 'Long-press and drag to select words. No Android menu or Google “Touch to Search”.'}
        </p>
      </div>
      <button className="flex min-h-14 w-full items-center gap-3 border-t border-line py-2 text-left" onClick={() => setPicking(true)} data-testid="dictionary-app">
        <BookOpenText size={20} className="shrink-0 text-muted" />
        <span className="flex-1">
          <span className="block text-[15px]">Dictionary app</span>
          <span className="block text-sm text-muted">{lookupAppName(st.lookup)} — used by “Look up” when you select a word</span>
        </span>
        <ChevronRight size={18} className="text-muted" />
      </button>
      <Sheet open={picking} onClose={() => setPicking(false)} title="Dictionary app" testId="dictionary-sheet">
        <p className="mb-2 text-sm text-muted">Pick once — “Look up” then opens it directly. Websites can’t see which apps you have, so these are popular dictionaries.</p>
        <div role="radiogroup" aria-label="Dictionary app">
          {LOOKUP_APPS.map((a) => (
            <button
              key={a.id}
              role="radio"
              aria-checked={st.lookup === a.id}
              onClick={() => st.set({ lookup: a.id })}
              className="flex min-h-14 w-full items-center gap-3 border-b border-line text-left last:border-b-0"
            >
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${st.lookup === a.id ? 'border-primary bg-primary text-on-primary' : 'border-line'}`}>
                {st.lookup === a.id && <Check size={14} />}
              </span>
              <span className="flex-1 py-2">
                <span className="block text-[15px] font-medium">{a.name}</span>
                <span className="block text-sm text-muted">{a.note}</span>
              </span>
            </button>
          ))}
        </div>
        <button className="mt-4 h-12 w-full rounded-full bg-primary font-semibold text-on-primary" onClick={() => void lookUp('serendipity', st.lookup)} data-testid="dictionary-try">
          Try it with “serendipity”
        </button>
      </Sheet>
    </Group>
  )
}
