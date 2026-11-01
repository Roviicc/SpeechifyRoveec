/*
 * Google sign-in + Picker for the main app.
 *
 * The app is cross-origin isolated (COOP same-origin + COEP credentialless) so the voice can use WASM threads.
 * COOP same-origin severs window.opener, which breaks the Google Identity Services popup, and COEP blocks the
 * Picker's Google iframe. So sign-in and the Picker run on a separate, NON-isolated same-origin page
 * (/google.html, see src/google/main.ts) opened as a popup. It reports back over a BroadcastChannel and stores
 * the token in localStorage (both shared by same-origin pages, isolated or not). Drive REST calls themselves are
 * plain CORS fetches with a Bearer token and work fine under COEP.
 */
import {
  BRIDGE_CHANNEL,
  BRIDGE_PATH,
  CONNECTED_KEY,
  TOKEN_KEY,
  driveConfigured,
  storedToken,
  type BridgeMessage,
  type BridgeOp,
  type PickedFile,
} from './googleShared'

export { driveConfigured, isConnected, SCOPES, CLIENT_ID, API_KEY } from './googleShared'
export type { PickedFile } from './googleShared'

export class NeedsSignIn extends Error {
  constructor() {
    super('Google sign-in needed')
    this.name = 'NeedsSignIn'
  }
}

export function hasValidToken(): boolean {
  return !!storedToken()
}

/** How long to wait for the sign-in page to say hello before giving up (it failed to load / was blocked). */
const HELLO_TIMEOUT_MS = 20_000

/**
 * Open the sign-in page for `op` and resolve with its final message. Must be called from a user gesture
 * (window.open runs synchronously here). The page posts `closed` if the user closes it without finishing.
 */
export function runBridge(op: BridgeOp, opts: { helloTimeoutMs?: number } = {}): Promise<BridgeMessage> {
  const id = crypto.randomUUID()
  const ch = new BroadcastChannel(BRIDGE_CHANNEL)
  return new Promise<BridgeMessage>((resolve, reject) => {
    let greeted = false
    const finish = (fn: () => void) => {
      clearTimeout(timer)
      ch.close()
      fn()
    }
    const timer = setTimeout(() => {
      if (!greeted) finish(() => reject(new Error("Couldn't open the Google sign-in window (offline?).")))
    }, opts.helloTimeoutMs ?? HELLO_TIMEOUT_MS)
    ch.onmessage = (ev: MessageEvent<BridgeMessage>) => {
      const m = ev.data
      if (!m || m.id !== id) return
      if (m.type === 'hello') {
        greeted = true
        return
      }
      finish(() => resolve(m))
    }
    const wide = op === 'pick'
    const w = Math.min(screen.availWidth || 1000, wide ? 1000 : 480)
    const h = Math.min(screen.availHeight || 700, wide ? 700 : 600)
    const left = Math.max(0, Math.round(((screen.availWidth || w) - w) / 2))
    const top = Math.max(0, Math.round(((screen.availHeight || h) - h) / 2))
    // Note: with COOP the returned WindowProxy is severed (it reads as closed), so only null = blocked is useful.
    const win = window.open(`${BRIDGE_PATH}?op=${op}&id=${id}`, 'lumen-google', `popup,width=${w},height=${h},left=${left},top=${top}`)
    if (!win) finish(() => reject(new Error('Pop-up blocked. Allow pop-ups for this site, then try again.')))
  })
}

let inflight: Promise<string> | null = null

/** Get an access token. Non-interactive calls only use a cached, unexpired token. */
export async function getToken(interactive = false): Promise<string> {
  const t = storedToken()
  if (t) return t.value
  if (!interactive) throw new NeedsSignIn()
  if (!driveConfigured) throw new Error('Google Drive is not configured (set VITE_GOOGLE_CLIENT_ID and VITE_GOOGLE_API_KEY).')
  inflight ??= runBridge('token')
    .then((m) => {
      if (m.type === 'token') return m.token
      if (m.type === 'error') throw new Error(m.message)
      throw new Error('Sign-in was cancelled')
    })
    .finally(() => {
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
  if (t) {
    // fire-and-forget revoke; no-cors keeps it COEP-compatible (we don't need the response)
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      mode: 'no-cors',
      body: new URLSearchParams({ token: t.value }),
    }).catch(() => {})
  }
}

/** Show the Google Picker for EPUB/PDF files (in the sign-in window). Resolves with the picked files (empty if cancelled). */
export async function pickDriveFiles(): Promise<PickedFile[]> {
  if (!driveConfigured) throw new Error('Google Drive is not configured (set VITE_GOOGLE_CLIENT_ID and VITE_GOOGLE_API_KEY).')
  const m = await runBridge('pick')
  if (m.type === 'picked') return m.docs
  if (m.type === 'error') throw new Error(m.message)
  return []
}
