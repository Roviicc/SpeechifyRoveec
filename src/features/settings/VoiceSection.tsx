import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Check, ChevronRight, Download, Sparkles, Trash2, Wand2, Zap } from 'lucide-react'
import { usePlayback } from '@/state/playback'
import { ProgressRing, Segmented } from '@/ui/controls'
import { toast } from '@/ui/toast'
import { getAutoVoice, getEnginePref, getVoicePref, setAutoVoice, setEnginePref, setVoicePref, effectiveVoice, type EnginePref, type VoicePref } from '@/engine/voice/choice/engineChoice'
import { formatBytes, freeBytes, removeVoice, voiceStorage, type VoiceStorage } from '@/engine/voice/install'
import type { VoiceModel } from '@/engine/voice/types'
import { session } from '@/session/session'
import { navigate } from '@/app/router'
import { VOICES } from '@/features/voice/voiceInfo'
import { Group } from './Group'

const Ring = ({ fraction }: { fraction: number | null }) => <ProgressRing fraction={fraction} />

function Row({ selected, icon, title, subtitle, trailing, onSelect, testId }: { selected: boolean; icon: ReactNode; title: ReactNode; subtitle: ReactNode; trailing?: ReactNode; onSelect: () => void; testId: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-line py-3 last:border-b-0" data-testid={testId}>
      <button role="radio" aria-checked={selected} onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${selected ? 'bg-primary text-on-primary' : 'bg-bg text-muted'}`}>{selected ? <Check size={20} /> : icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">{title}</span>
          <span className="block text-sm text-muted">{subtitle}</span>
        </span>
      </button>
      {trailing}
    </div>
  )
}

/** Settings → Voice: pick Auto / Natural / Fast, see what is on this device, download or remove voices. */
export function VoiceSection() {
  const model = usePlayback((s) => s.model)
  const [pref, setPrefState] = useState<VoicePref>(getVoicePref())
  const [engine, setEngine] = useState<EnginePref>(getEnginePref())
  const [stored, setStored] = useState<VoiceStorage | null>(null)
  const [free, setFree] = useState<number | null>(null)
  const auto = getAutoVoice()
  const current = effectiveVoice(pref, auto)

  const refresh = useCallback(() => {
    void voiceStorage().then(setStored)
    void freeBytes().then(setFree)
  }, [])
  useEffect(refresh, [refresh, model.status])

  const choose = (p: VoicePref) => {
    setPrefState(p)
    setVoicePref(p)
    if (p === 'auto') setAutoVoice(null) // test this device again
    session().switchEngine()
    session().prepareVoice() // asks before downloading if the voice is not on the device yet
  }

  const installed = (v: VoiceModel) => (v === 'piper' ? !!stored?.piper.installed : !!(stored?.kokoro.q8 || stored?.kokoro.fp32))
  const busy = (v: VoiceModel) => model.voice === v && (model.status === 'downloading' || model.status === 'loading')

  const status = (v: VoiceModel) => {
    if (busy(v) && model.status === 'downloading') return <Ring fraction={model.fraction} />
    if (installed(v))
      return (
        <span className="flex items-center gap-1">
          <span className="flex items-center gap-1 text-xs font-semibold text-green-700 dark:text-green-400" data-testid={`voice-installed-${v}`}>
            <Check size={14} /> On device
          </span>
          {v !== current && (
            <button
              aria-label={`Remove the ${VOICES[v].name} voice`}
              className="grid h-10 w-10 place-items-center rounded-full text-muted hover:bg-surface-2"
              onClick={async () => {
                await removeVoice(v)
                toast(`${VOICES[v].name} voice removed from this device`)
                refresh()
              }}
            >
              <Trash2 size={17} />
            </button>
          )}
        </span>
      )
    return (
      <button
        aria-label={`Download the ${VOICES[v].name} voice`}
        className="grid h-10 w-10 place-items-center rounded-full text-primary hover:bg-surface-2"
        onClick={() => choose(v)}
        data-testid={`voice-download-${v}`}
      >
        <Download size={20} />
      </button>
    )
  }

  const onDevice = stored ? stored.piper.bytes + stored.kokoro.bytes : 0
  return (
    <Group title="Voice">
      <div role="radiogroup" aria-label="Voice" data-testid="voice-list">
        <Row
          testId="voice-row-auto"
          selected={pref === 'auto'}
          onSelect={() => choose('auto')}
          icon={<Wand2 size={19} />}
          title="Auto"
          subtitle={auto ? `Using ${VOICES[auto].name} — ${auto === 'piper' ? 'Natural was too slow here' : 'this device is fast enough'}` : 'Picks Natural if this device is fast enough, otherwise Fast'}
        />
        {(['kokoro', 'piper'] as const).map((v) => (
          <Row
            key={v}
            testId={`voice-row-${v}`}
            selected={pref === v}
            onSelect={() => choose(v)}
            icon={v === 'kokoro' ? <Sparkles size={19} /> : <Zap size={19} />}
            title={
              <>
                {VOICES[v].name} <span className="font-normal text-muted">· {VOICES[v].engine}</span>
              </>
            }
            subtitle={`${VOICES[v].blurb} ${formatBytes(VOICES[v].bytes)}`}
            trailing={status(v)}
          />
        ))}
      </div>
      <p className="pt-1 pb-3 text-xs text-muted" data-testid="voice-choice-note">
        {onDevice ? `Voices on this device: ${formatBytes(onDevice)}` : 'No voice downloaded yet — it downloads once, then works offline'}
        {free !== null ? ` · ${formatBytes(free)} free` : ''}
      </p>
      {current === 'kokoro' && (
        <details className="border-t border-line py-3">
          <summary className="cursor-pointer text-[15px]">Natural voice: run on GPU or processor</summary>
          <div className="pt-2">
            <Segmented<EnginePref>
              label="Voice engine"
              value={engine}
              onChange={(e) => {
                setEngine(e)
                setEnginePref(e)
                session().switchEngine()
              }}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'gpu', label: 'GPU' },
                { value: 'cpu', label: 'Processor' },
              ]}
            />
            <p className="mt-1.5 text-sm text-muted">Auto tests your GPU once and uses the processor if the GPU is too slow. If playback stutters or the phone lags, try Processor.</p>
          </div>
        </details>
      )}
      <button className="flex min-h-12 w-full items-center border-t border-line text-left text-[15px]" onClick={() => navigate({ name: 'tts' })} data-testid="open-tts-test">
        <span className="flex-1">Voice test page</span>
        <ChevronRight size={18} className="text-muted" />
      </button>
    </Group>
  )
}
