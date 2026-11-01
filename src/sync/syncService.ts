import { create } from 'zustand'
import { db } from '@/data/db'
import { notifyChange } from '@/data/repo'
import { settingsSnapshot, useSettings } from '@/state/settings'
import { DriveAuthError, GoogleDriveClient } from '@/sync/drive/client'
import { driveConfigured, forgetToken, getToken, hasValidToken, isConnected, NeedsSignIn } from '@/sync/drive/google'
import { syncOnce, type SettingsBridge } from './syncCore'

export interface SyncStatus {
  status: 'off' | 'idle' | 'syncing' | 'error' | 'signin'
  lastSync?: number
  error?: string
}

export const useSync = create<SyncStatus>(() => ({ status: driveConfigured && isConnected() ? 'idle' : 'off' }))

const progressListeners = new Set<(bookIds: string[]) => void>()
/** Fires after a sync brought in newer reading progress from another device. */
export function onRemoteProgress(fn: (bookIds: string[]) => void) {
  progressListeners.add(fn)
  return () => progressListeners.delete(fn)
}

export const settingsBridge: SettingsBridge = {
  get: settingsSnapshot,
  replace: (s) => useSettings.getState().replace(s),
}

export const drive = new GoogleDriveClient(() => getToken(false))

let running: Promise<void> | null = null

/** Sync now. Non-interactive runs silently skip when there is no valid token. */
export function syncNow(interactive = false): Promise<void> {
  if (!driveConfigured || !isConnected()) {
    useSync.setState({ status: 'off' })
    return Promise.resolve()
  }
  if (!interactive && !hasValidToken()) {
    useSync.setState({ status: 'signin' })
    return Promise.resolve()
  }
  running ??= (async () => {
    useSync.setState({ status: 'syncing', error: undefined })
    try {
      if (interactive) await getToken(true)
      const { changedProgress } = await syncOnce(db, drive, settingsBridge)
      useSync.setState({ status: 'idle', lastSync: Date.now() })
      notifyChange()
      if (changedProgress.length) progressListeners.forEach((fn) => fn(changedProgress))
    } catch (e) {
      if (e instanceof DriveAuthError || e instanceof NeedsSignIn) {
        forgetToken()
        useSync.setState({ status: 'signin' })
      } else useSync.setState({ status: 'error', error: (e as Error).message })
    }
  })().finally(() => {
    running = null
  })
  return running
}

let soon: ReturnType<typeof setTimeout> | null = null
/** Debounced background sync after a local change. */
export function syncSoon(ms = 3000) {
  if (!isConnected()) return
  if (soon) clearTimeout(soon)
  soon = setTimeout(() => void syncNow(false), ms)
}

/** Sync on open, every 60 s while playing, on pause and when the app is hidden. */
export function startSyncLoop(isPlaying: () => boolean) {
  void syncNow(false)
  setInterval(() => {
    if (isPlaying()) void syncNow(false)
  }, 60_000)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void syncNow(false)
    else syncSoon(500)
  })
}
