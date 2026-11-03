import { useEffect, useState } from 'react'
import { ArrowDownToLine, AudioLines, CircleCheck, CloudAlert, CloudCheck, CloudDownload, CloudUpload } from 'lucide-react'
import { session } from '@/session/session'
import { usePrepare } from '@/state/prepare'
import { useAudioShare } from '@/state/audioShare'
import { useSettings } from '@/state/settings'
import type { BookShare } from '@/sync/audio/audioShare'
import { autoDownloadAllowed } from '@/sync/audio/network'
import { usePlayback } from '@/state/playback'
import { opusSupported } from '@/engine/voice/player/opus'
import { audioBytesPerSecond } from '@/session/storageRoom'
import type { PrepareJob, PreparerState } from '@/session/preparer'
import { ProgressRing, formatMinutes } from '@/ui/controls'

export function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  const mb = bytes / 1024 ** 2
  return `${mb >= 10 ? Math.round(mb) : Math.max(0.1, Math.round(mb * 10) / 10)} MB`
}

/** Whether stored audio is compressed here (decides the size estimate). */
function useOpus(): boolean {
  const [opus, setOpus] = useState(true)
  useEffect(() => {
    void opusSupported().then(setOpus)
  }, [])
  return opus
}

/** The job (running or queued) that covers sentences start..end of a book, if any. */
export function coveringJob(st: PreparerState, bookId: string, start: number, end: number): { job: PrepareJob; running: boolean } | null {
  const covers = (j: PrepareJob) => j.bookId === bookId && j.from <= start && j.to >= end
  if (st.current && covers(st.current.job)) return { job: st.current.job, running: true }
  const q = st.queue.find(covers)
  return q ? { job: q, running: false } : null
}

/** Rough audio length and storage size of `chars` spoken characters at 1x. */
function useEstimate() {
  const opus = useOpus()
  const rtf = usePlayback((s) => s.rtf)
  return (chars: number) => {
    const s = session()
    const audioSec = chars * s.secondsPerChar
    const r = rtf ?? s.backend.info?.testRtf ?? null
    return { audioSec, bytes: audioSec * audioBytesPerSecond(opus), prepareSec: r === null ? null : audioSec * r }
  }
}

/** Top of the Contents list: prepare the whole book ahead, or follow / cancel what is being prepared. */
export function PrepareHeader({ bookId, totalChars, have, count }: { bookId: string; totalChars: number; have: number; count: number }) {
  const st = usePrepare()
  const estimate = useEstimate()
  const mine = st.current?.job.bookId === bookId ? st.current : null
  const queued = st.queue.filter((j) => j.bookId === bookId).length
  const busy = !!mine || queued > 0
  const all = estimate(totalChars)
  const ready = count > 0 && have >= count
  const left = estimate(count ? totalChars * (1 - have / count) : 0)

  let detail: string
  if (mine) {
    const pct = mine.total ? Math.round((mine.done / mine.total) * 100) : 0
    const eta = mine.etaSec !== null ? ` · ${formatMinutes(mine.etaSec)} left` : ''
    detail = `${mine.job.label} · ${pct}%${eta}${queued ? ` · ${queued} more queued` : ''}`
  } else if (queued) detail = `${queued} queued`
  else if (ready) detail = `All audio is ready · ${formatSize(all.bytes)}`
  else
    detail = `≈ ${formatMinutes(all.audioSec)} of audio · ~${formatSize(all.bytes)}${
      left.prepareSec !== null ? ` · ~${formatMinutes(left.prepareSec)} to prepare` : ''
    }`

  return (
    <div className="mb-3 rounded-[16px] border border-line px-3 py-2.5" data-testid="prepare-summary">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft text-primary" aria-hidden>
          {mine ? <ProgressRing fraction={mine.total ? mine.done / mine.total : 0} size={24} /> : ready ? <CircleCheck size={18} /> : <AudioLines size={18} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">{busy ? 'Preparing audio' : 'Prepare audio ahead'}</span>
          <span className="block truncate text-xs text-muted" aria-live="polite" data-testid="prepare-detail">
            {detail}
          </span>
        </span>
        {busy ? (
          <button className="h-9 shrink-0 rounded-full bg-surface px-4 text-sm font-semibold" onClick={() => session().preparer.cancel()} data-testid="prepare-cancel">
            Cancel
          </button>
        ) : (
          !ready && (
            <button
              className="h-9 shrink-0 rounded-full bg-primary px-4 text-sm font-semibold text-on-primary"
              onClick={() => session().prepare(bookId, 0, count - 1, 'Whole book')}
              data-testid="prepare-all"
            >
              Prepare all
            </button>
          )
        )}
      </div>
      <DriveShareLine bookId={bookId} />
    </div>
  )
}

/** Whether prepared audio is shared through Drive right now (connected, signed in, setting on). */
export function useShareOn(): boolean {
  // re-render when the setting or the Drive state changes
  useSettings((s) => s.shareAudio)
  useAudioShare((s) => s.books)
  return session().shareOn()
}

const chapters = (n: number) => `${n} ${n === 1 ? 'chapter' : 'chapters'}`

/** The prepare card's Drive line: uploading / downloading / ready in Drive / not uploaded yet / uploaded. */
function DriveShareLine({ bookId }: { bookId: string }) {
  const on = useShareOn()
  const b = useAudioShare((s) => s.books[bookId])
  const error = useAudioShare((s) => s.error)
  useEffect(() => {
    if (on) void session().share.refresh(bookId)
  }, [on, bookId])
  if (!on) return null

  let icon = <CloudCheck size={16} />
  let text: string
  let action: { label: string; testId: string; run: () => void } | null = null
  if (b?.upload) {
    icon = <CloudUpload size={16} />
    text = `Uploading to Drive ${b.upload.done + 1}/${b.upload.total}`
  } else if (b?.download) {
    icon = <CloudDownload size={16} />
    text = `Downloading from Drive ${b.download.done + 1}/${b.download.total}`
  } else if (b?.missing.length) {
    icon = <CloudDownload size={16} />
    const auto = autoDownloadAllowed() && !b.autoBlocked
    text = `${chapters(b.missing.length)} ready in Drive${auto ? ' — downloading on Wi‑Fi' : ''}`
    action = { label: 'Download now', testId: 'drive-download', run: () => void session().share.download(bookId, { manual: true }) }
  } else if (error) {
    icon = <CloudAlert size={16} />
    text = error
    if (b?.notUploaded.length) action = { label: 'Try again', testId: 'drive-upload', run: () => void session().share.upload(bookId) }
  } else if (b?.notUploaded.length) {
    icon = <CloudUpload size={16} />
    text = `${chapters(b.notUploaded.length)} not in Drive yet`
    action = { label: 'Upload to Drive', testId: 'drive-upload', run: () => void session().share.upload(bookId) }
  } else if (b?.remote?.length) {
    text = `Uploaded to Drive · ${chapters(b.remote.length)}`
  } else if (!b?.remote) {
    text = 'Checking Google Drive…'
  } else return null

  return (
    <div className="mt-2 flex min-h-9 items-center gap-2 border-t border-line pt-2 text-xs text-muted" data-testid="drive-status">
      <span className="shrink-0 text-primary" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1" aria-live="polite" data-testid="drive-detail">
        {text}
      </span>
      {action && (
        <button className="h-9 shrink-0 rounded-full bg-surface px-3 text-sm font-semibold text-fg" onClick={action.run} data-testid={action.testId}>
          {action.label}
        </button>
      )}
    </div>
  )
}

const overlaps = (r: { from: number; to: number }, start: number, end: number) => r.from <= end && r.to >= start

/** Drive state of one chapter row (null = nothing Drive-specific to show). */
function rowShare(share: BookShare | undefined, start: number, end: number): 'uploading' | 'downloading' | 'cloud' | null {
  if (!share) return null
  if (share.download && overlaps(share.download.current, start, end)) return 'downloading'
  if (share.upload && overlaps(share.upload.current, start, end)) return 'uploading'
  if (share.missing.some((p) => overlaps(p, start, end))) return 'cloud'
  return null
}

/** Per-chapter control: Prepare / progress ring (tap to cancel) / ready mark. */
export function PrepareButton({ bookId, label, start, end, have, describedBy }: { bookId: string; label: string; start: number; end: number; have: number; describedBy?: string }) {
  const st = usePrepare()
  const share = useAudioShare((s) => s.books[bookId])
  const on = useShareOn()
  const total = end - start + 1
  if (total <= 0) return <span className="w-11 shrink-0" aria-hidden />
  const drive = on ? rowShare(share, start, end) : null
  if (drive === 'uploading')
    return (
      <span className="grid h-11 w-11 shrink-0 place-items-center text-primary" role="img" aria-label="Audio ready, uploading to Drive" aria-describedby={describedBy} data-testid="toc-uploading">
        <CloudUpload size={18} className="animate-pulse" />
      </span>
    )
  if (drive === 'downloading' && have < total)
    return (
      <span className="grid h-11 w-11 shrink-0 place-items-center" role="img" aria-label="Downloading audio from Drive" aria-describedby={describedBy} data-testid="toc-downloading">
        <ProgressRing fraction={null} size={22} />
      </span>
    )
  if (drive === 'cloud' && have < total && !coveringJob(st, bookId, start, end))
    return (
      <button
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-primary hover:bg-surface"
        aria-label="Prepared audio is in Drive. Download"
        aria-describedby={describedBy}
        title="Download prepared audio from Drive"
        onClick={() => void session().share.download(bookId, { manual: true, range: { from: start, to: end } })}
        data-testid="toc-cloud"
      >
        <CloudDownload size={18} />
      </button>
    )
  if (have >= total)
    return (
      <span className="grid h-11 w-11 shrink-0 place-items-center text-primary" role="img" aria-label="Audio ready" aria-describedby={describedBy} data-testid="toc-prepared">
        <CircleCheck size={18} />
      </span>
    )
  const job = coveringJob(st, bookId, start, end)
  if (job) {
    const fraction = have / total
    return (
      <button
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-surface"
        aria-label={job.running ? `Preparing audio, ${Math.round(fraction * 100)}%. Cancel` : 'Audio queued. Cancel'}
        aria-describedby={describedBy}
        title="Cancel"
        onClick={() => session().preparer.cancel(job.job.id)}
        data-testid="toc-preparing"
        data-queued={job.running ? undefined : true}
      >
        <ProgressRing fraction={fraction} size={22} className={job.running ? '' : 'opacity-50'} />
      </button>
    )
  }
  return (
    <button
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface hover:text-fg"
      aria-label="Prepare audio"
      aria-describedby={describedBy}
      title="Prepare audio"
      onClick={() => session().prepare(bookId, start, end, label)}
      data-testid="toc-prepare"
    >
      <ArrowDownToLine size={18} />
    </button>
  )
}
