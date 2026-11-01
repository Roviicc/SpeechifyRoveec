/*
 * Shared between the main app (cross-origin isolated) and the Google sign-in page /google.html
 * (NOT isolated). Both are the same origin, so they share localStorage and BroadcastChannel.
 */

const env = import.meta.env
export const CLIENT_ID: string = env.VITE_GOOGLE_CLIENT_ID ?? ''
export const API_KEY: string = env.VITE_GOOGLE_API_KEY ?? ''
export const APP_ID: string = env.VITE_GOOGLE_APP_ID ?? CLIENT_ID.split('-')[0] ?? ''
export const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata'
export const driveConfigured = Boolean(CLIENT_ID && API_KEY)

export const TOKEN_KEY = 'lumen-gtoken'
export const CONNECTED_KEY = 'lumen-drive-connected'

/** Path of the non-isolated sign-in page (excluded from COOP/COEP in vercel.json and vite.config.ts). */
export const BRIDGE_PATH = '/google.html'
export const BRIDGE_CHANNEL = 'lumen-google'

export interface PickedFile {
  id: string
  name: string
  mimeType: string
}

export type BridgeOp = 'token' | 'pick'

/** Messages the sign-in page posts on the BroadcastChannel. `id` echoes the request id from the URL. */
export type BridgeMessage =
  | { id: string; type: 'hello' }
  | { id: string; type: 'token'; token: string; expiresAt: number }
  | { id: string; type: 'picked'; docs: PickedFile[] }
  | { id: string; type: 'error'; message: string }
  | { id: string; type: 'closed' }

export function storedToken(): { value: string; expiresAt: number } | null {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null')
    return t && t.expiresAt > Date.now() + 60_000 ? t : null
  } catch {
    return null
  }
}

export function saveToken(value: string, expiresInSec = 3600): number {
  const expiresAt = Date.now() + expiresInSec * 1000
  localStorage.setItem(TOKEN_KEY, JSON.stringify({ value, expiresAt }))
  localStorage.setItem(CONNECTED_KEY, '1')
  return expiresAt
}

export function isConnected(): boolean {
  return localStorage.getItem(CONNECTED_KEY) === '1'
}
