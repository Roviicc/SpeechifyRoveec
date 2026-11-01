import { useEffect, useState, type ReactNode } from 'react'
import { ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useSettings } from '../../store/settings'
import { usePlayback } from '../../store/playback'
import { Segmented, Toggle } from '../../ui/controls'
import { getEnginePref, getVoiceModel, setEnginePref, setVoiceModel, type EnginePref } from '../../engine/tts/engineChoice'
import { ThemePicker } from '../reader/sheets'
import { audioStore } from '../../data/audioCache'
import { session } from '../../app/session'
import { navigate } from '../../app/router'
import { driveConfigured, disconnect, getToken, isConnected } from '../../sync/google'
import { syncNow, useSync } from '../../sync/syncService'
import { toast } from '../../ui/toast'

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 px-1 text-sm font-semibold tracking-wide text-muted uppercase">{title}</h2>
      <div className="rounded-[16px] bg-surface px-4 py-2">{children}</div>
    </section>
  )
}

function mb(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`
}

export function SettingsScreen() {
  const st = useSettings()
  const model = usePlayback((s) => s.model)
  const device = usePlayback((s) => s.device)
  const sync = useSync()
  const [cacheSize, setCacheSize] = useState<number | null>(null)
  const [word, setWord] = useState('')
  const [say, setSay] = useState('')
  const [connected, setConnected] = useState(isConnected())
  const [engine, setEngine] = useState<EnginePref>(getEnginePref())
  const [voiceModel, setVoiceModelState] = useState(getVoiceModel())

  useEffect(() => {
    void audioStore.totalSize().then(setCacheSize)
  }, [])

  const skip = (k: keyof typeof st.skip, v: boolean) => st.set({ skip: { ...st.skip, [k]: v } })

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-8" data-testid="settings">
      <header className="safe-top flex h-16 items-center">
        <h1 className="text-[28px] font-bold tracking-tight">Settings</h1>
      </header>

      <Group title="Appearance">
        <div className="py-2">
          <ThemePicker value={st.theme} onChange={(theme) => st.set({ theme })} />
        </div>
      </Group>

      <Group title="Reading">
        <Toggle label="Highlight current sentence" checked={st.highlightSentence} onChange={(v) => st.set({ highlightSentence: v })} testId="toggle-hl-sentence" />
        <Toggle label="Highlight current word" checked={st.highlightWord} onChange={(v) => st.set({ highlightWord: v })} testId="toggle-hl-word" />
        <Toggle label="Auto-scroll" description="Keep the sentence being read in view" checked={st.autoScroll} onChange={(v) => st.set({ autoScroll: v })} />
      </Group>

      <Group title="Smart skip">
        <Toggle label="Headers & footers" description="Lines repeated at the top/bottom of PDF pages" checked={st.skip.headersFooters} onChange={(v) => skip('headersFooters', v)} />
        <Toggle label="Page numbers" checked={st.skip.pageNumbers} onChange={(v) => skip('pageNumbers', v)} />
        <Toggle label="Citations" description="Like [12] or (Smith, 2020)" checked={st.skip.citations} onChange={(v) => skip('citations', v)} testId="toggle-skip-citations" />
        <Toggle label="Footnote markers" checked={st.skip.footnotes} onChange={(v) => skip('footnotes', v)} />
        <Toggle label="Read URLs as “link”" checked={st.skip.urls} onChange={(v) => skip('urls', v)} />
      </Group>

      <Group title="Pronunciation">
        <p className="pt-1 pb-2 text-sm text-muted">Teach the voice how to say words. Whole words, case-insensitive.</p>
        <ul data-testid="dictionary">
          {st.dictionary.map((e, i) => (
            <li key={i} className="flex min-h-11 items-center gap-2 border-b border-line text-[15px]">
              <span className="min-w-0 flex-1 truncate font-medium">{e.word}</span>
              <span className="text-muted">→</span>
              <span className="min-w-0 flex-1 truncate">{e.say}</span>
              <button aria-label={`Remove ${e.word}`} className="grid h-10 w-10 place-items-center rounded-full text-muted hover:bg-surface-2" onClick={() => st.set({ dictionary: st.dictionary.filter((_, k) => k !== i) })}>
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
            st.set({ dictionary: [...st.dictionary.filter((d) => d.word.toLowerCase() !== word.trim().toLowerCase()), { word: word.trim(), say: say.trim() }] })
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

      <Group title="Google Drive">
        {!driveConfigured ? (
          <p className="py-2 text-sm text-muted">Not configured. Add VITE_GOOGLE_CLIENT_ID and VITE_GOOGLE_API_KEY to .env (see README).</p>
        ) : connected ? (
          <div className="py-2">
            <p className="text-[15px]">Connected. Progress, bookmarks, highlights and settings sync between your devices.</p>
            <p className="mt-1 text-sm text-muted" data-testid="sync-status">
              {sync.status === 'syncing'
                ? 'Syncing…'
                : sync.status === 'error'
                  ? `Sync failed: ${sync.error}`
                  : sync.status === 'signin'
                    ? 'Sign-in expired — tap “Sync now”.'
                    : sync.lastSync
                      ? `Last synced ${new Date(sync.lastSync).toLocaleTimeString()}`
                      : 'Not synced yet'}
            </p>
            <div className="mt-3 flex gap-2">
              <button className="h-11 flex-1 rounded-full bg-primary font-semibold text-on-primary" onClick={() => void syncNow(true)}>
                Sync now
              </button>
              <button
                className="h-11 flex-1 rounded-full bg-bg font-semibold"
                onClick={() => {
                  void disconnect()
                  setConnected(false)
                  useSync.setState({ status: 'off' })
                }}
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="py-2">
            <p className="text-[15px]">Connect to import books from Drive and sync your reading between devices.</p>
            <button
              className="mt-3 h-11 w-full rounded-full bg-primary font-semibold text-on-primary"
              onClick={async () => {
                try {
                  await getToken(true)
                  setConnected(true)
                  await syncNow(false)
                } catch (e) {
                  toast((e as Error).message)
                }
              }}
            >
              Connect Google Drive
            </button>
          </div>
        )}
      </Group>

      <Group title="Voice">
        <div className="py-2 text-[15px]">
          <Segmented<'kokoro' | 'piper'>
            label="Voice"
            value={voiceModel}
            onChange={(v) => {
              setVoiceModelState(v)
              setVoiceModel(v)
              session().switchEngine()
            }}
            options={[
              { value: 'kokoro', label: 'Natural (Kokoro)' },
              { value: 'piper', label: 'Fast (Piper)' },
            ]}
          />
          <p className="mt-1.5 text-sm text-muted">
            {voiceModel === 'kokoro'
              ? 'Most natural. Needs a fast phone or a GPU (one-time download ~90–330 MB).'
              : 'Lighter voice that runs smoothly on most phones (one-time download ~65 MB).'}
          </p>
          <p className="mt-1 text-sm text-muted" data-testid="voice-status">
            {model.status === 'ready' ? `Ready on ${device}` : model.status === 'downloading' ? `Downloading… ${Math.round((model.fraction ?? 0) * 100)}%` : model.status === 'error' ? `Error: ${model.error}` : model.status === 'loading' ? 'Loading…' : 'Downloads on first play (one time)'}
          </p>
          {model.status !== 'ready' && model.status !== 'downloading' && (
            <button className="mt-3 h-11 w-full rounded-full bg-bg font-semibold" onClick={() => void session().ensureModel()}>
              Download voice now
            </button>
          )}
        </div>
        {voiceModel === 'kokoro' && (
        <div className="border-t border-line py-3">
          <div className="mb-1.5 text-[15px]">Voice engine</div>
          <Segmented<EnginePref>
            label="Voice engine"
            value={engine}
            onChange={(v) => {
              setEngine(v)
              setEnginePref(v)
              session().switchEngine()
            }}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'gpu', label: 'GPU' },
              { value: 'cpu', label: 'Processor' },
            ]}
          />
          <p className="mt-1.5 text-sm text-muted">Auto tests your GPU once and uses the processor if the GPU is too slow. If playback stutters or the phone lags, try Processor.</p>
        </div>
        )}
        <button className="flex min-h-12 w-full items-center border-t border-line text-left text-[15px]" onClick={() => navigate({ name: 'tts' })} data-testid="open-tts-test">
          <span className="flex-1">Voice test page</span>
          <ChevronRight size={18} className="text-muted" />
        </button>
      </Group>

      <Group title="Storage">
        <div className="flex min-h-12 items-center gap-3 py-2">
          <span className="flex-1 text-[15px]">
            Audio cache
            <span className="block text-sm text-muted">{cacheSize === null ? '…' : mb(cacheSize)} of 500 MB</span>
          </span>
          <button
            className="h-10 rounded-full bg-bg px-4 text-sm font-semibold"
            onClick={async () => {
              await audioStore.clear()
              setCacheSize(0)
              toast('Audio cache cleared')
            }}
          >
            Clear
          </button>
        </div>
      </Group>

      <p className="px-1 text-center text-xs text-muted">Lumen · on-device voice, no account, no server</p>
    </div>
  )
}
