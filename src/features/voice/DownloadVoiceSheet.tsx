import { useEffect, useState } from 'react'
import { Download, WifiOff } from 'lucide-react'
import { Sheet } from '@/ui/Sheet'
import { usePlayback } from '@/state/playback'
import { session } from '@/session/session'
import { formatBytes, freeBytes } from '@/engine/voice/install'
import { getVoicePref } from '@/engine/voice/choice/engineChoice'
import { onMobileData, VOICES } from './voiceInfo'

/** Asks before a first-time voice download: size, works offline afterwards, free space, mobile data. */
export function DownloadVoiceSheet() {
  const voice = usePlayback((s) => s.downloadPrompt)
  const [free, setFree] = useState<number | null>(null)
  useEffect(() => {
    if (voice) void freeBytes().then(setFree)
  }, [voice])
  const info = voice ? VOICES[voice] : null
  const auto = getVoicePref() === 'auto'
  const mobile = onMobileData()
  return (
    <Sheet open={!!info} onClose={() => session().cancelDownload()} title={auto ? 'Download a voice?' : `Download the ${info?.name} voice?`} testId="download-voice-sheet">
      {info && (
        <>
          <div className="mb-4 flex items-center gap-3 rounded-[16px] bg-surface p-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
              <Download size={22} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {auto ? 'Best voice for this device' : `${info.name} voice`} · {auto ? `${formatBytes(VOICES.piper.bytes)}–${formatBytes(VOICES.kokoro.bytes)}` : formatBytes(info.bytes)}
              </p>
              <p className="text-sm text-muted">{auto ? 'Lumen checks how fast this device is and keeps the voice that plays smoothly.' : info.blurb}</p>
            </div>
          </div>
          <ul className="mb-5 space-y-1.5 text-[15px]">
            <li className="flex gap-2">
              <WifiOff size={18} className="mt-0.5 shrink-0 text-muted" /> One-time download. After that it works offline.
            </li>
            {free !== null && <li className="pl-[26px] text-sm text-muted">{formatBytes(free)} free on this device.</li>}
            <li className={`pl-[26px] text-sm ${mobile ? 'font-semibold text-red-600' : 'text-muted'}`}>
              {mobile ? 'You are on mobile data — Wi-Fi is recommended.' : 'Downloads may use mobile data.'}
            </li>
          </ul>
          <div className="grid grid-cols-2 gap-3">
            <button className="h-12 rounded-full bg-surface font-semibold" onClick={() => session().cancelDownload()} data-testid="download-cancel">
              Not now
            </button>
            <button className="h-12 rounded-full bg-primary font-semibold text-on-primary" onClick={() => session().confirmDownload()} data-testid="download-confirm">
              Download
            </button>
          </div>
        </>
      )}
    </Sheet>
  )
}
