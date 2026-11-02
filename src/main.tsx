import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from '@/app/App'
import { session } from '@/session/session'
import { startSyncLoop } from '@/sync/syncService'
import { importBook } from '@/features/library/import/importBook'
import { navigate } from '@/app/router'
import { inAndroidApp } from '@/features/reader/lookup'
import { useSettings } from '@/state/settings'

// create the playback session before React renders (its constructor updates stores)
session()

// Inside the Lumen Android app, "Look up" uses the native helper (installed apps, ColorDict popup) by default
if (inAndroidApp() && useSettings.getState().lookup === 'share') useSettings.getState().set({ lookup: 'android-app' })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

startSyncLoop(() => session().player.isActive)

// Register the service worker (offline app shell). Skipped in dev.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }))
}

// "Open with Lumen" from the OS file handler (installed PWA on desktop)
const lq = (window as Window & { launchQueue?: { setConsumer(cb: (p: { files: Array<{ getFile(): Promise<File> }> }) => void): void } }).launchQueue
lq?.setConsumer(async (params) => {
  for (const h of params.files ?? []) {
    const f = await h.getFile()
    const id = await importBook(f, f.name).catch(() => null)
    if (id) navigate({ name: 'reader', bookId: id })
  }
})

// test hook (used by Playwright e2e)
// Test/diagnostics hook, only in dev builds or when a test/debug flag is in the URL (?tts=… or ?debug)
const params = new URLSearchParams(location.search)
if (import.meta.env.DEV || params.has('tts') || params.has('debug')) {
  ;(window as unknown as { __lumen: unknown }).__lumen = { session, importBook }
}
