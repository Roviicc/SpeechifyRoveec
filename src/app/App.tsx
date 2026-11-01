import { useEffect, useState } from 'react'
import { Library, Pause, Play, Plus, Settings as SettingsIcon } from 'lucide-react'
import { navigate, useRoute } from './router'
import { session } from '@/session/session'
import { LibraryScreen } from '@/features/library/LibraryScreen'
import { ReaderScreen } from '@/features/reader/ReaderScreen'
import { SettingsScreen } from '@/features/settings/SettingsScreen'
import { VoiceTestScreen } from '@/features/voice-test/VoiceTestScreen'
import { ImportSheet } from '@/features/library/import/ImportSheet'
import { usePlayback } from '@/state/playback'
import { applyTheme, useSettings } from '@/state/settings'
import { Thumb } from '@/ui/controls'
import { useToasts } from '@/ui/toast'

function MiniPlayer() {
  const { bookId, title, cover, state } = usePlayback()
  if (!bookId || bookId.startsWith('scratch-')) return null
  const playing = state === 'playing' || state === 'buffering'
  return (
    <div className="mx-3 mb-2 flex items-center gap-3 rounded-[16px] border border-line bg-bg p-2 shadow-[var(--shadow)]" data-testid="mini-player">
      <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => navigate({ name: 'reader', bookId })}>
        <Thumb cover={cover} type="" size={34} />
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</span>
      </button>
      <button
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={() => session().toggle()}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-on-primary"
        data-testid="mini-play"
      >
        {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-0.5" />}
      </button>
    </div>
  )
}

function BottomNav({ active, onPlus }: { active: 'library' | 'settings' | null; onPlus: () => void }) {
  const item = (on: boolean) => `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium ${on ? 'text-primary' : 'text-muted'}`
  return (
    <nav className="safe-bottom flex items-center border-t border-line bg-bg px-6" aria-label="Main">
      <button className={item(active === 'library')} onClick={() => navigate({ name: 'library' })} aria-current={active === 'library' ? 'page' : undefined} data-testid="nav-library">
        <Library size={24} />
        Library
      </button>
      <button
        aria-label="Import a book"
        onClick={onPlus}
        data-testid="nav-plus"
        className="-mt-6 grid h-16 w-16 place-items-center rounded-full bg-primary text-on-primary shadow-lg ring-4 ring-bg transition active:scale-95"
      >
        <Plus size={32} strokeWidth={2.5} />
      </button>
      <button className={item(active === 'settings')} onClick={() => navigate({ name: 'settings' })} aria-current={active === 'settings' ? 'page' : undefined} data-testid="nav-settings">
        <SettingsIcon size={24} />
        Settings
      </button>
    </nav>
  )
}

function Toasts() {
  const toasts = useToasts((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed top-4 right-0 left-0 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="anim-fade max-w-md rounded-[16px] bg-fg px-4 py-3 text-sm text-bg shadow-[var(--shadow)]">
          {t.text}
        </div>
      ))}
    </div>
  )
}

function DebugOverlay() {
  const { device, isolated, threads, rtf, model, state, index, count } = usePlayback()
  if (!new URLSearchParams(location.search).has('debug')) return null
  // the page's own isolation is known before the model loads; the worker reports its thread count when ready
  const coi = isolated ?? self.crossOriginIsolated
  return (
    <div className="pointer-events-none fixed top-16 right-2 z-[70] rounded-lg bg-black/75 px-3 py-2 font-mono text-[11px] leading-5 text-white" data-testid="debug-overlay">
      <div>device: {device ?? model.status}</div>
      <div data-testid="debug-isolation">
        isolated: {coi ? 'yes' : 'no'} · threads: {threads ?? '—'}
      </div>
      <div>RTF: {rtf ? rtf.toFixed(3) : '—'}</div>
      <div>
        state: {state} {index + 1}/{count}
      </div>
    </div>
  )
}

export function App() {
  const route = useRoute()
  const theme = useSettings((s) => s.theme)
  const [importOpen, setImportOpen] = useState(false)

  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const on = () => applyTheme('system')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [theme])

  const withNav = route.name === 'library' || route.name === 'settings'
  return (
    <div className="flex h-full flex-col">
      <main className="min-h-0 flex-1 overflow-y-auto">
        {route.name === 'library' && <LibraryScreen onImport={() => setImportOpen(true)} />}
        {route.name === 'settings' && <SettingsScreen />}
        {route.name === 'reader' && <ReaderScreen key={route.bookId} bookId={route.bookId} />}
        {route.name === 'tts' && <VoiceTestScreen />}
      </main>
      {withNav && (
        <>
          <MiniPlayer />
          <BottomNav active={route.name === 'library' ? 'library' : 'settings'} onPlus={() => setImportOpen(true)} />
        </>
      )}
      <ImportSheet
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(id) => {
          setImportOpen(false)
          if (id) navigate({ name: 'reader', bookId: id })
        }}
      />
      <Toasts />
      <DebugOverlay />
    </div>
  )
}
