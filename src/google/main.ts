/*
 * The NON-isolated Google sign-in page (/google.html), opened as a popup by the main app (src/sync/google.ts).
 * Runs the Google Identity Services token client and the Google Picker, then hands the token / picked files
 * back over a BroadcastChannel and closes itself. Query: ?op=token|pick&id=<request id>
 */
import {
  API_KEY,
  APP_ID,
  BRIDGE_CHANNEL,
  CLIENT_ID,
  SCOPES,
  driveConfigured,
  isConnected,
  saveToken,
  storedToken,
  type BridgeMessage,
  type PickedFile,
} from '../sync/googleShared'

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}
interface TokenClient {
  callback: (r: TokenResponse) => void
  error_callback?: (e: { type: string; message?: string }) => void
  requestAccessToken(opts?: { prompt?: string }): void
}
interface PickerBuilder {
  addView(v: unknown): PickerBuilder
  enableFeature(f: unknown): PickerBuilder
  setOAuthToken(t: string): PickerBuilder
  setDeveloperKey(k: string): PickerBuilder
  setAppId(id: string): PickerBuilder
  setCallback(cb: (data: { action: string; docs?: PickedFile[] }) => void): PickerBuilder
  setTitle(t: string): PickerBuilder
  build(): { setVisible(v: boolean): void }
}
interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient(cfg: { client_id: string; scope: string; callback: (r: TokenResponse) => void }): TokenClient
    }
  }
  picker: {
    DocsView: new (viewId?: unknown) => { setMimeTypes(m: string): unknown; setIncludeFolders(b: boolean): unknown; setMode(m: unknown): unknown }
    ViewId: { DOCS: unknown }
    DocsViewMode: { LIST: unknown }
    PickerBuilder: new () => PickerBuilder
    Feature: { MULTISELECT_ENABLED: unknown; SUPPORT_DRIVES: unknown }
    Action: { PICKED: string; CANCEL: string }
  }
}
const w = window as unknown as { google?: GoogleGlobal; gapi?: { load(name: string, cb: () => void): void } }

const q = new URLSearchParams(location.search)
const op = q.get('op') === 'pick' ? 'pick' : 'token'
const id = q.get('id') ?? ''
const channel = new BroadcastChannel(BRIDGE_CHANNEL)
const statusEl = document.getElementById('status')!
const goBtn = document.getElementById('go') as HTMLButtonElement
const cancelBtn = document.getElementById('cancel') as HTMLButtonElement

let finished = false
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never
type Payload = WithoutId<BridgeMessage>
const send = (m: Payload) => channel.postMessage({ ...m, id } as BridgeMessage)

function finish(m: Payload) {
  if (finished) return
  finished = true
  send(m)
  statusEl.textContent = m.type === 'error' ? m.message : 'Done — you can close this window.'
  goBtn.hidden = true
  cancelBtn.textContent = 'Close'
  // give the message a moment to leave before the page goes away
  setTimeout(() => window.close(), 150)
}

function status(text: string, button?: string) {
  statusEl.textContent = text
  goBtn.hidden = !button
  if (button) goBtn.textContent = button
}

addEventListener('pagehide', () => {
  if (!finished) send({ type: 'closed' })
})
cancelBtn.onclick = () => {
  if (!finished) finish({ type: 'closed' })
  else window.close()
}

const scripts = new Map<string, Promise<void>>()
function loadScript(src: string): Promise<void> {
  let p = scripts.get(src)
  if (!p) {
    p = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = src
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => {
        scripts.delete(src)
        reject(new Error(`Couldn't load ${src} (offline?)`))
      }
      document.head.append(s)
    })
    scripts.set(src, p)
  }
  return p
}

let tokenClient: TokenClient | null = null

/** Opens the Google consent popup. Must run inside a click handler on this page (popup blockers). */
function requestToken(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const g = w.google!
    tokenClient ??= g.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPES, callback: () => {} })
    tokenClient.callback = (r) => {
      if (r.error || !r.access_token) return reject(new Error(r.error_description || r.error || 'Sign-in failed'))
      saveToken(r.access_token, r.expires_in ?? 3600)
      resolve(r.access_token)
    }
    tokenClient.error_callback = (e) => reject(Object.assign(new Error(e.message || e.type), { gisType: e.type }))
    tokenClient.requestAccessToken({ prompt: isConnected() ? '' : 'consent' })
  })
}

async function showPicker(token: string) {
  status('Choose EPUB or PDF files…')
  await loadScript('https://apis.google.com/js/api.js')
  await new Promise<void>((r) => w.gapi!.load('picker', () => r()))
  const p = w.google!.picker
  const view = new p.DocsView(p.ViewId.DOCS)
  view.setMimeTypes('application/pdf,application/epub+zip')
  view.setIncludeFolders(true)
  view.setMode(p.DocsViewMode.LIST)
  new p.PickerBuilder()
    .addView(view)
    .enableFeature(p.Feature.MULTISELECT_ENABLED)
    .enableFeature(p.Feature.SUPPORT_DRIVES)
    .setOAuthToken(token)
    .setDeveloperKey(API_KEY)
    .setAppId(APP_ID)
    .setTitle('Choose books')
    .setCallback((data) => {
      if (data.action === p.Action.PICKED) {
        finish({ type: 'picked', docs: (data.docs ?? []).map((d) => ({ id: d.id, name: d.name, mimeType: d.mimeType })) })
      } else if (data.action === p.Action.CANCEL) {
        finish({ type: 'picked', docs: [] })
      }
    })
    .build()
    .setVisible(true)
}

async function main() {
  send({ type: 'hello' })
  if (!id) return status('This page is opened by Lumen when you connect Google Drive.')
  if (!driveConfigured) return finish({ type: 'error', message: 'Google Drive is not configured (set VITE_GOOGLE_CLIENT_ID and VITE_GOOGLE_API_KEY).' })

  const existing = storedToken()
  if (op === 'pick' && existing) return showPicker(existing.value).catch((e: Error) => finish({ type: 'error', message: e.message }))

  try {
    await loadScript('https://accounts.google.com/gsi/client')
  } catch (e) {
    return finish({ type: 'error', message: (e as Error).message })
  }
  const prompt = op === 'pick' ? 'Sign in to choose books from your Google Drive.' : 'Sign in to import books and sync your reading between devices.'
  status(prompt, 'Continue with Google')
  goBtn.onclick = async () => {
    goBtn.disabled = true
    try {
      const token = await requestToken()
      if (op === 'token') finish({ type: 'token', token, expiresAt: storedToken()?.expiresAt ?? Date.now() + 3600_000 })
      else await showPicker(token)
    } catch (e) {
      const err = e as Error & { gisType?: string }
      // popup closed / blocked: let the user try again (or close this window)
      if (err.gisType === 'popup_closed' || err.gisType === 'popup_failed_to_open') status(`${err.gisType === 'popup_closed' ? 'Sign-in was cancelled.' : 'Pop-up blocked.'} ${prompt}`, 'Try again')
      else finish({ type: 'error', message: err.message })
    } finally {
      goBtn.disabled = false
    }
  }
}

void main()
