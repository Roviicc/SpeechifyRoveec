import { useCallback, useEffect, useState } from 'react'
import { audioStore, type PreparedUsage } from '@/data/audioCache'
import { db } from '@/data/db'
import { session } from '@/session/session'
import { useSettings, type PrepareSpeed } from '@/state/settings'
import { usePrepare } from '@/state/prepare'
import { Segmented, Toggle } from '@/ui/controls'
import { useAudioShare } from '@/state/audioShare'
import { driveConfigured, isConnected } from '@/sync/drive/google'
import { useSync } from '@/sync/syncService'
import type { SyncBook } from '@/sync/merge'
import { toast } from '@/ui/toast'
import { formatSize } from '@/features/reader/sheets/PrepareControls'
import { Group } from './Group'

function mb(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`
}

interface PreparedBook extends PreparedUsage {
  bookId: string
  title: string
  /** bytes of this book's audio packs in Google Drive (null: not known / not shared) */
  inDrive: number | null
}

export function StorageSection() {
  const [cacheSize, setCacheSize] = useState<number | null>(null)
  const [prepared, setPrepared] = useState<PreparedBook[] | null>(null)
  const [free, setFree] = useState<number | null>(null)
  const prepareSpeed = useSettings((s) => s.prepareSpeed)
  const setSettings = useSettings((s) => s.set)
  const shareAudio = useSettings((s) => s.shareAudio)
  // refresh the list when a preparation run or a Drive transfer ends
  const running = usePrepare((s) => !!s.current)
  const transfers = useAudioShare((s) => Object.values(s.books).filter((b) => b.upload || b.download).length)
  const syncStatus = useSync((s) => s.status)
  const driveOn = driveConfigured && isConnected() && syncStatus !== 'off'
  const sharing = driveOn && shareAudio

  const load = useCallback(async () => {
    void audioStore.totalSize().then(setCacheSize)
    const usage = await audioStore.preparedUsage()
    const remote = session().shareOn() ? await session().share.listAll().catch(() => null) : null
    const ids = [...new Set([...usage.keys(), ...(remote?.keys() ?? [])])]
    const books = await db.books.bulkGet(ids)
    const synced = ((await db.settings.get('lastSyncDoc'))?.value as { books?: Record<string, SyncBook> } | undefined)?.books ?? {}
    setPrepared(
      ids.map((bookId, k) => ({
        bookId,
        bytes: usage.get(bookId)?.bytes ?? 0,
        count: usage.get(bookId)?.count ?? 0,
        title: books[k]?.title ?? synced[bookId]?.title ?? 'Removed book',
        inDrive: remote ? (remote.get(bookId)?.bytes ?? 0) : null,
      })),
    )
    const est = await navigator.storage?.estimate?.().catch(() => null)
    setFree(est?.quota ? Math.max(0, est.quota - (est.usage ?? 0)) : null)
  }, [])

  useEffect(() => {
    void load()
  }, [load, running, transfers, sharing])

  return (
    <Group title="Storage">
      <div className="flex min-h-12 items-center gap-3 border-b border-line py-2">
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
      <div className="border-b border-line py-3" data-testid="prepared-audio">
        <span className="block text-[15px]">Prepared audio</span>
        <span className="block text-sm text-muted">
          Chapters prepared from Contents play without waiting for the voice and are kept until you delete them.
          {free !== null && ` ${formatSize(free)} free on this device.`}
        </span>
        {prepared && prepared.length === 0 && <span className="mt-2 block text-sm text-muted">Nothing prepared yet.</span>}
        {prepared && prepared.length > 0 && (
          <ul className="mt-2">
            {prepared.map((p) => (
              <li key={p.bookId} className="py-1.5" data-testid="prepared-book">
                <div className="flex min-h-12 items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px]">{p.title}</span>
                    <span className="block text-sm text-muted">
                      {p.count ? `${formatSize(p.bytes)} · ${p.count} ${p.count === 1 ? 'sentence' : 'sentences'}` : 'Not on this device'}
                    </span>
                  </span>
                  {p.count > 0 && (
                    <button
                      className="h-10 shrink-0 rounded-full bg-bg px-4 text-sm font-semibold"
                      aria-label={`Delete prepared audio of ${p.title} from this device`}
                      data-testid="prepared-delete"
                      onClick={async () => {
                        session().preparer.cancelBook(p.bookId)
                        await audioStore.deletePrepared(p.bookId)
                        // Drive copies stay; don't download them again by themselves
                        session().share.localDeleted(p.bookId)
                        toast(p.inDrive ? 'Prepared audio deleted from this device (still in Drive)' : 'Prepared audio deleted')
                        void load()
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
                {!!p.inDrive && (
                  <div className="flex min-h-11 items-center gap-3 pl-0" data-testid="prepared-drive">
                    <span className="flex-1 text-sm text-muted">In Drive: {formatSize(p.inDrive)}</span>
                    <button
                      className="h-10 shrink-0 rounded-full bg-bg px-4 text-sm font-semibold"
                      aria-label={`Remove prepared audio of ${p.title} from Google Drive`}
                      data-testid="drive-remove"
                      onClick={async () => {
                        await session().share.remove(p.bookId)
                        toast('Removed from Google Drive')
                        void load()
                      }}
                    >
                      Remove from Drive
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {driveOn && (
        <div className="border-b border-line">
          <Toggle
            label="Share prepared audio through Google Drive"
            description="Audio prepared here is uploaded to Lumen’s hidden folder in your Drive, and your other devices download it on Wi‑Fi."
            checked={shareAudio}
            onChange={(v) => setSettings({ shareAudio: v })}
            testId="toggle-share-audio"
          />
        </div>
      )}
      <div className="py-3">
        <span className="mb-1 block text-[15px]">Preparing speed</span>
        <span className="mb-2 block text-sm text-muted">Lighter settings rest between sentences: cooler and quieter, but slower. Playback is never slowed.</span>
        <Segmented<PrepareSpeed>
          label="Preparing speed"
          value={prepareSpeed}
          onChange={(v) => setSettings({ prepareSpeed: v })}
          options={[
            { value: 'full', label: 'Full' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'light', label: 'Light' },
          ]}
        />
      </div>
    </Group>
  )
}
