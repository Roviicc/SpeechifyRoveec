import { useState } from 'react'
import { driveConfigured, disconnect, getToken, isConnected } from '@/sync/drive/google'
import { syncNow, useSync } from '@/sync/syncService'
import { toast } from '@/ui/toast'
import { Group } from './Group'

function syncStatusText(sync: ReturnType<typeof useSync.getState>): string {
  if (sync.status === 'syncing') return 'Syncing…'
  if (sync.status === 'error') return `Sync failed: ${sync.error}`
  if (sync.status === 'signin') return 'Sign-in expired — tap “Sync now”.'
  return sync.lastSync ? `Last synced ${new Date(sync.lastSync).toLocaleTimeString()}` : 'Not synced yet'
}

export function DriveSection() {
  const sync = useSync()
  const [connected, setConnected] = useState(isConnected())
  return (
    <Group title="Google Drive">
      {!driveConfigured ? (
        <p className="py-2 text-sm text-muted">Not configured. Add VITE_GOOGLE_CLIENT_ID and VITE_GOOGLE_API_KEY to .env (see README).</p>
      ) : connected ? (
        <div className="py-2">
          <p className="text-[15px]">Connected. Progress, bookmarks, highlights and settings sync between your devices.</p>
          <p className="mt-1 text-sm text-muted" data-testid="sync-status">
            {syncStatusText(sync)}
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
  )
}
