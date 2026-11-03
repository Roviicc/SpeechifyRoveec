import { useCallback, useEffect, useState } from 'react'
import { audioStore, type PreparedUsage } from '@/data/audioCache'
import { db } from '@/data/db'
import { session } from '@/session/session'
import { PREPARE_USAGE_MAX, PREPARE_USAGE_MIN, useSettings, type PrepareWorkers } from '@/state/settings'
import { usePrepare } from '@/state/prepare'
import { usePlayback } from '@/state/playback'
import { effectiveVoice } from '@/engine/voice/choice/engineChoice'
import { formatRealtime } from '@/session/dutyCycle'
import { Segmented, Slider, Toggle, formatMinutes } from '@/ui/controls'
import { showTurbo, useHasGpu } from './gpuStatus'
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
      <PreparingControls />
    </Group>
  )
}

/** Settings → Storage: how hard preparing works the GPU (duty cycle), Turbo workers, and the measured speed. */
function PreparingControls() {
  const usage = useSettings((s) => s.prepareUsage)
  const workers = useSettings((s) => s.prepareWorkers)
  const setSettings = useSettings((s) => s.set)
  const current = usePrepare((s) => s.current)
  const note = usePrepare((s) => s.note)
  const engineDevice = usePlayback((s) => s.engineDevice)
  const voice = usePlayback((s) => s.model.voice) ?? effectiveVoice()
  const hasGpu = useHasGpu()
  const turbo = !!hasGpu && showTurbo(hasGpu, voice, engineDevice)
  const stats = current?.stats
  return (
    <div className="py-3" data-testid="preparing-controls">
      <div className="mb-1 flex items-baseline gap-3">
        <span className="flex-1 text-[15px]" id="prepare-usage-label">
          GPU usage while preparing
        </span>
        <span className="text-[15px] font-semibold tabular-nums" data-testid="prepare-usage-value">
          {usage}%
        </span>
      </div>
      <span className="mb-2 block text-sm text-muted">Lower values rest between sentences: cooler and quieter, but slower. Playback is never slowed.</span>
      <Slider
        label="GPU usage while preparing"
        min={PREPARE_USAGE_MIN}
        max={PREPARE_USAGE_MAX}
        step={10}
        value={usage}
        format={(v) => `${v}%`}
        onChange={(v) => setSettings({ prepareUsage: v })}
        testId="prepare-usage"
      />
      {turbo && (
        <div className="mt-4" data-testid="prepare-turbo">
          <span className="mb-1 block text-[15px]">Turbo</span>
          <span className="mb-2 block text-sm text-muted">Extra voice workers on the GPU prepare several sentences at once. Each one uses more GPU memory.</span>
          <Segmented<'1' | '2' | '3'>
            label="Turbo voice workers"
            value={String(workers) as '1' | '2' | '3'}
            onChange={(v) => setSettings({ prepareWorkers: Number(v) as PrepareWorkers })}
            options={[
              { value: '1', label: 'Off' },
              { value: '2', label: '×2' },
              { value: '3', label: '×3' },
            ]}
          />
        </div>
      )}
      {current && (
        <p className="mt-3 text-sm text-muted tabular-nums" data-testid="prepare-stats" aria-live="polite">
          {stats ? (
            <>
              <span className="font-semibold text-fg">{formatRealtime(stats.xRealtime)}</span>
              {` · ${stats.perMin.toFixed(stats.perMin >= 100 ? 0 : 1)} sentences/min`}
              {current.etaSec !== null ? ` · ${formatMinutes(current.etaSec)} left` : ''}
              {(current.workers ?? 1) > 1 ? ` · ${current.workers} workers` : ''}
            </>
          ) : (
            'Measuring speed…'
          )}
        </p>
      )}
      {note && (
        <p className="mt-2 text-xs text-muted" data-testid="prepare-note">
          {note}
        </p>
      )}
    </div>
  )
}
