import { useSettings } from '@/state/settings'
import { Segmented, Toggle } from '@/ui/controls'
import { Group } from './Group'

export function ReadingSection() {
  const st = useSettings()
  return (
    <Group title="Reading">
      <Toggle label="Highlight current sentence" checked={st.highlightSentence} onChange={(v) => st.set({ highlightSentence: v })} testId="toggle-hl-sentence" />
      <Toggle label="Highlight current word" checked={st.highlightWord} onChange={(v) => st.set({ highlightWord: v })} testId="toggle-hl-word" />
      <Toggle label="Auto-scroll" description="Keep the sentence being read in view" checked={st.autoScroll} onChange={(v) => st.set({ autoScroll: v })} />
      <div className="border-t border-line py-3">
        <div className="mb-1.5 text-[15px]">Look up words with</div>
        <Segmented<'share' | 'colordict'>
          label="Look up words with"
          value={st.lookup}
          onChange={(v) => st.set({ lookup: v })}
          options={[
            { value: 'share', label: 'Choose app' },
            { value: 'colordict', label: 'ColorDict' },
          ]}
        />
        <p className="mt-1.5 text-sm text-muted">
          {st.lookup === 'share'
            ? 'Select a word, tap the book icon and pick ColorDict, Translate or any dictionary from the list.'
            : 'Opens ColorDict directly (experimental — if nothing happens, use “Choose app”).'}
        </p>
      </div>
    </Group>
  )
}
