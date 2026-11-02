import type { TtsBackend, TtsInfo, VoiceModel } from '@/engine/voice/types'
import { isVoiceInstalled } from '@/engine/voice/install'
import { IDLE_MODEL, usePlayback } from '@/state/playback'

/** Short device description for Settings / the debug overlay, e.g. "wasm / q8 (GPU too slow: RTF 3.2)". */
export function deviceLabel(info: TtsInfo): string {
  const auto = info.autoSwitched ? 'auto→piper · ' : ''
  const gpu = info.gpuRejected ? ` (GPU too slow${info.gpuRejected.rtf ? `: RTF ${info.gpuRejected.rtf.toFixed(1)}` : ''})` : ''
  return `${auto}${info.device} / ${info.dtype}${gpu}`
}

/** Voice the backend is using right now (Auto may switch from Kokoro to Piper while loading). */
function currentVoice(backend: TtsBackend): VoiceModel {
  return (backend as { voice?: VoiceModel }).voice ?? 'kokoro'
}

/**
 * Make sure the voice model is loading; reports progress to the playback store. If the voice's files are already on
 * this device the status stays "loading" (never "downloading"), even though the library reports progress events.
 */
export function ensureModel(backend: TtsBackend): Promise<void> {
  const m = usePlayback.getState().model
  if (m.status === 'ready' || m.status === 'downloading' || m.status === 'loading') return Promise.resolve()
  const voice = currentVoice(backend)
  usePlayback.setState({ model: { ...m, status: 'loading', error: undefined, voice, fromDevice: undefined } })
  return isVoiceInstalled(voice)
    .catch(() => false)
    .then((fromDevice) => {
      usePlayback.setState((s) => ({ model: { ...s.model, fromDevice } }))
      return backend.init((p) => {
        const v = currentVoice(backend)
        // Auto switched voice mid-load: the new voice may need a real download
        const stored = v === voice ? fromDevice : false
        usePlayback.setState({
          model: {
            status: stored && p.status === 'downloading' ? 'loading' : p.status,
            fraction: p.fraction,
            loadedBytes: p.loadedBytes,
            totalBytes: p.totalBytes,
            fromDevice: stored,
            voice: v,
          },
        })
      })
    })
    .then((info) => {
      usePlayback.setState({
        device: deviceLabel(info),
        isolated: info.isolated,
        threads: info.threads,
        model: { ...usePlayback.getState().model, status: 'ready', voice: currentVoice(backend) },
      })
      void navigator.storage?.persist?.()
    })
    .catch((e: Error) => {
      usePlayback.setState({ model: { ...usePlayback.getState().model, status: 'error', error: e.message } })
    })
}

/** Forget the loaded model in the store (after switching the voice engine). */
export function resetModelState() {
  usePlayback.setState({ device: undefined, rtf: undefined, model: { ...IDLE_MODEL } })
}
