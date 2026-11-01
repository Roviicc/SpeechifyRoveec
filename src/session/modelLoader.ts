import type { TtsBackend, TtsInfo } from '@/engine/voice/types'
import { IDLE_MODEL, usePlayback } from '@/state/playback'

/** Short device description for Settings / the debug overlay, e.g. "wasm / q8 (GPU too slow: RTF 3.2)". */
export function deviceLabel(info: TtsInfo): string {
  const auto = info.autoSwitched ? 'auto→piper · ' : ''
  const gpu = info.gpuRejected ? ` (GPU too slow${info.gpuRejected.rtf ? `: RTF ${info.gpuRejected.rtf.toFixed(1)}` : ''})` : ''
  return `${auto}${info.device} / ${info.dtype}${gpu}`
}

/** Make sure the voice model is loading; reports download progress to the playback store. */
export function ensureModel(backend: TtsBackend): Promise<void> {
  const m = usePlayback.getState().model
  if (m.status === 'ready' || m.status === 'downloading' || m.status === 'loading') return Promise.resolve()
  usePlayback.setState({ model: { ...m, status: 'loading', error: undefined } })
  return backend
    .init((p) =>
      usePlayback.setState({
        model: { status: p.status, fraction: p.fraction, loadedBytes: p.loadedBytes, totalBytes: p.totalBytes },
      }),
    )
    .then((info) => {
      usePlayback.setState({
        device: deviceLabel(info),
        isolated: info.isolated,
        threads: info.threads,
        model: { ...usePlayback.getState().model, status: 'ready' },
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
