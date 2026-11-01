import { useSettings } from '@/state/settings'
import { Toggle } from '@/ui/controls'
import { Group } from './Group'

export function ReadingSection() {
  const st = useSettings()
  return (
    <Group title="Reading">
      <Toggle label="Highlight current sentence" checked={st.highlightSentence} onChange={(v) => st.set({ highlightSentence: v })} testId="toggle-hl-sentence" />
      <Toggle label="Highlight current word" checked={st.highlightWord} onChange={(v) => st.set({ highlightWord: v })} testId="toggle-hl-word" />
      <Toggle label="Auto-scroll" description="Keep the sentence being read in view" checked={st.autoScroll} onChange={(v) => st.set({ autoScroll: v })} />
    </Group>
  )
}
