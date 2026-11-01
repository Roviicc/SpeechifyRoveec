import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useSettings } from '../../store/settings'
import { Group } from './Group'

export function PronunciationSection() {
  const dictionary = useSettings((s) => s.dictionary)
  const set = useSettings((s) => s.set)
  const [word, setWord] = useState('')
  const [say, setSay] = useState('')
  return (
    <Group title="Pronunciation">
      <p className="pt-1 pb-2 text-sm text-muted">Teach the voice how to say words. Whole words, case-insensitive.</p>
      <ul data-testid="dictionary">
        {dictionary.map((e, i) => (
          <li key={i} className="flex min-h-11 items-center gap-2 border-b border-line text-[15px]">
            <span className="min-w-0 flex-1 truncate font-medium">{e.word}</span>
            <span className="text-muted">→</span>
            <span className="min-w-0 flex-1 truncate">{e.say}</span>
            <button aria-label={`Remove ${e.word}`} className="grid h-10 w-10 place-items-center rounded-full text-muted hover:bg-surface-2" onClick={() => set({ dictionary: dictionary.filter((_, k) => k !== i) })}>
              <Trash2 size={17} />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex items-center gap-2 py-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!word.trim() || !say.trim()) return
          set({ dictionary: [...dictionary.filter((d) => d.word.toLowerCase() !== word.trim().toLowerCase()), { word: word.trim(), say: say.trim() }] })
          setWord('')
          setSay('')
        }}
      >
        <input value={word} onChange={(e) => setWord(e.target.value)} placeholder="Word" aria-label="Word" data-testid="dict-word" className="h-11 min-w-0 flex-1 rounded-full bg-bg px-4 text-[15px] outline-none focus:ring-2 focus:ring-primary" />
        <input value={say} onChange={(e) => setSay(e.target.value)} placeholder="Say as" aria-label="Say as" data-testid="dict-say" className="h-11 min-w-0 flex-1 rounded-full bg-bg px-4 text-[15px] outline-none focus:ring-2 focus:ring-primary" />
        <button type="submit" aria-label="Add pronunciation" data-testid="dict-add" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-on-primary">
          <Plus size={20} />
        </button>
      </form>
    </Group>
  )
}
