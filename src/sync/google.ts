/* Google Identity Services (token client) + Google Picker, loaded on demand. */

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
interface PickerDoc {
  id: string
  name: string
  mimeType: string
}
interface PickerBuilder {
  addView(v: unknown): PickerBuilder
  enableFeature(f: unknown): PickerBuilder
  setOAuthToken(t: string): PickerBuilder
  setDeveloperKey(k: string): PickerBuilder
  setAppId(id: string): PickerBuilder
  setCallback(cb: (data: { action: string; docs?: PickerDoc[] }) => void): PickerBuilder
  setTitle(t: string): PickerBuilder
  build(): { setVisible(v: boolean): void }
}
interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient(cfg: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type: string }) => void }): TokenClient
      revoke(token: string, done?: () => void): void
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
declare global {
  interface Window {
    google?: GoogleGlobal
    gapi?: { load(name: string, cb: () => void): void }
  }
}

const env = import.meta.env
export const CLIENT_ID: string = env.VITE_GOOGLE_CLIENT_ID ?? ''
export const API_KEY: string = env.VITE_GOOGLE_API_KEY ?? ''
const APP_ID: string = env.VITE_GOOGLE_APP_ID ?? CLIENT_ID.split('-')[0] ?? ''
export const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata'
export const driveConfigured = Boolean(CLIENT_ID && API_KEY)

const TOKEN_KEY = 'lumen-gtoken'
const CONNECTED_KEY = 'lumen-drive-connected'

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

export class NeedsSignIn extends Error {
  constructor() {
    super('Google sign-in needed')
    this.name = 'NeedsSignIn'
  }
}

function storedToken(): { value: string; expiresAt: number } | null {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null')
    return t && t.expiresAt > Date.now() + 60_000 ? t : null
  } catch {
    return null
  }
}

export function isConnected(): boolean {
  return localStorage.getItem(CONNECTED_KEY) === '1'
}

export function hasValidToken(): boolean {
  return !!storedToken()
}

let tokenClient: TokenClient | null = null
let inflight: Promise<string> | null = null

/** Get an access token. Non-interactive calls only use a cached, unexpired token. */
export async function getToken(interactive = false): Promise<string> {
  const t = storedToken()
  if (t) return t.value
  if (!interactive) throw new NeedsSignIn()
  if (!driveConfigured) throw new Error('Google Drive is not configured (set VITE_GOOGLE_CLIENT_ID and VITE_GOOGLE_API_KEY).')
  inflight ??= (async () => {
    await loadScript('https://accounts.google.com/gsi/client')
    const g = window.google!
    return new Promise<string>((resolve, reject) => {
      tokenClient ??= g.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPES, callback: () => {} })
      tokenClient.callback = (r) => {
        if (r.error || !r.access_token) return reject(new Error(r.error_description || r.error || 'Sign-in failed'))
        localStorage.setItem(TOKEN_KEY, JSON.stringify({ value: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 }))
        localStorage.setItem(CONNECTED_KEY, '1')
        resolve(r.access_token)
      }
      tokenClient.error_callback = (e) => reject(new Error(e.type === 'popup_closed' ? 'Sign-in was cancelled' : e.message || e.type))
      tokenClient.requestAccessToken({ prompt: isConnected() ? '' : 'consent' })
    })
  })().finally(() => {
    inflight = null
  })
  return inflight
}

export function forgetToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export async function disconnect() {
  const t = storedToken()
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(CONNECTED_KEY)
  if (t && window.google) window.google.accounts.oauth2.revoke(t.value)
}

/** Show the Google Picker for EPUB/PDF files. Resolves with the picked files (empty if cancelled). */
export async function pickDriveFiles(): Promise<PickerDoc[]> {
  const token = await getToken(true)
  await loadScript('https://apis.google.com/js/api.js')
  await new Promise<void>((r) => window.gapi!.load('picker', () => r()))
  const p = window.google!.picker
  return new Promise((resolve) => {
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
        if (data.action === p.Action.PICKED) resolve(data.docs ?? [])
        else if (data.action === p.Action.CANCEL) resolve([])
      })
      .build()
      .setVisible(true)
  })
}
