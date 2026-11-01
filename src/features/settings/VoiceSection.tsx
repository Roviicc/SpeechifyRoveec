import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { usePlayback } from '@/state/playback'
import { Segmented } from '@/ui/controls'
import { effectiveVoice, getAutoVoice, getEnginePref, getVoicePref, setAutoVoice, setEnginePref, setVoicePref, type EnginePref, type VoicePref } from '@/engine/voice/choice/engineChoice'
import { session } from '@/session/session'
import { navigate } from '@/app/router'
import { Group } from './Group'

function choiceNote(pref: VoicePref, auto: 'kokoro' | 'piper' | null): string {
  if (pref === 'kokoro') return 'Natural (Kokoro): most natural. Needs a fast phone or a GPU (one-time download ~90–330 MB).'
  if (pref === 'piper') return 'Fast (Piper): lighter voice that runs smoothly on most phones (one-time download ~65 MB).'
  if (auto === 'piper') return 'Auto is using the Fast voice (Piper): the natural voice was too slow on this device.'
  if (auto === 'kokoro') return 'Auto is using the Natural voice (Kokoro): this device is fast enough.'
  return 'Auto tries the Natural voice on first play and switches to the Fast voice if this device is too slow.'
}

function modelStatusText(model: ReturnType<typeof usePlayback.getState>['model'], device: string | undefined): string {
  if (model.status === 'ready') return `Ready on ${device}`
  if (model.status === 'downloading') return `Downloading… ${Math.round((model.fraction ?? 0) * 100)}%`
  if (model.status === 'error') return `Error: ${model.error}`
  if (model.status === 'loading') return 'Loading…'
  return 'Downloads on first play (one time)'
}

export function VoiceSection() {
  const model = usePlayback((s) => s.model)
  const device = usePlayback((s) => s.device)
  const [engine, setEngine] = useState<EnginePref>(getEnginePref())
  const [voicePref, setVoicePrefState] = useState<VoicePref>(getVoicePref())
  const autoVoice = getAutoVoice()
  const voiceModel = effectiveVoice(voicePref, autoVoice)

  return (
    <Group title="Voice">
      <div className="py-2 text-[15px]">
        <Segmented<VoicePref>
          label="Voice"
          value={voicePref}
          onChange={(v) => {
            setVoicePrefState(v)
            setVoicePref(v)
            if (v === 'auto') setAutoVoice(null) // test this device again
            session().switchEngine()
          }}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'kokoro', label: 'Natural' },
            { value: 'piper', label: 'Fast' },
          ]}
        />
        <p className="mt-1.5 text-sm text-muted" data-testid="voice-choice-note">
          {choiceNote(voicePref, autoVoice)}
        </p>
        <p className="mt-1 text-sm text-muted" data-testid="voice-status">
          {modelStatusText(model, device)}
        </p>
        {model.status !== 'ready' && model.status !== 'downloading' && (
          <button className="mt-3 h-11 w-full rounded-full bg-bg font-semibold" onClick={() => void session().ensureModel()}>
            Download voice now
          </button>
        )}
      </div>
      {voiceModel === 'kokoro' && (
        <div className="border-t border-line py-3">
          <div className="mb-1.5 text-[15px]">Voice engine</div>
          <Segmented<EnginePref>
            label="Voice engine"
            value={engine}
            onChange={(v) => {
              setEngine(v)
              setEnginePref(v)
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
      )}
      <button className="flex min-h-12 w-full items-center border-t border-line text-left text-[15px]" onClick={() => navigate({ name: 'tts' })} data-testid="open-tts-test">
        <span className="flex-1">Voice test page</span>
        <ChevronRight size={18} className="text-muted" />
      </button>
    </Group>
  )
}
