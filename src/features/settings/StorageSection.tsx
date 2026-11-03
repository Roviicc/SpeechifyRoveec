import { useCallback, useEffect, useState } from 'react'
import { audioStore, type PreparedUsage } from '@/data/audioCache'
import { db } from '@/data/db'
import { session } from '@/session/session'
import { useSettings, type PrepareSpeed } from '@/state/settings'
import { usePrepare } from '@/state/prepare'
import { Segmented } from '@/ui/controls'
import { toast } from '@/ui/toast'
import { formatSize } from '@/features/reader/sheets/PrepareControls'
import { Group } from './Group'

function mb(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`
}

interface PreparedBook extends PreparedUsage {
  bookId: string
  title: string
}

export function StorageSection() {
  const [cacheSize, setCacheSize] = useState<number | null>(null)
  const [prepared, setPrepared] = useState<PreparedBook[] | null>(null)
  const [free, setFree] = useState<number | null>(null)
  const prepareSpeed = useSettings((s) => s.prepareSpeed)
  const setSettings = useSettings((s) => s.set)
  // refresh the list when a preparation run ends
  const running = usePrepare((s) => !!s.current)

  const load = useCallback(async () => {
    void audioStore.totalSize().then(setCacheSize)
    const usage = await audioStore.preparedUsage()
    const books = await db.books.bulkGet([...usage.keys()])
    setPrepared([...usage].map(([bookId, u], k) => ({ bookId, ...u, title: books[k]?.title ?? 'Removed book' })))
    const est = await navigator.storage?.estimate?.().catch(() => null)
    setFree(est?.quota ? Math.max(0, est.quota - (est.usage ?? 0)) : null)
  }, [])

  useEffect(() => {
    void load()
  }, [load, running])

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
              <li key={p.bookId} className="flex min-h-12 items-center gap-3 py-1" data-testid="prepared-book">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px]">{p.title}</span>
                  <span className="block text-sm text-muted">
                    {formatSize(p.bytes)} · {p.count} {p.count === 1 ? 'sentence' : 'sentences'}
                  </span>
                </span>
                <button
                  className="h-10 shrink-0 rounded-full bg-bg px-4 text-sm font-semibold"
                  aria-label={`Delete prepared audio of ${p.title}`}
                  data-testid="prepared-delete"
                  onClick={async () => {
                    session().preparer.cancelBook(p.bookId)
                    await audioStore.deletePrepared(p.bookId)
                    toast('Prepared audio deleted')
                    void load()
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
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
