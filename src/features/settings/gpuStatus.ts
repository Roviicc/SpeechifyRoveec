import { useEffect, useState } from 'react'
import { gpuAvailable } from '@/engine/voice/gpu'
import type { TtsDevice, VoiceModel } from '@/engine/voice/types'

/**
 * Whether the Natural voice runs (or will run) on the GPU here: the device has a WebGPU adapter and the loaded
 * voice did not fall back to the processor. `engineDevice` is undefined while no voice is loaded.
 */
export function naturalOnGpu(hasGpu: boolean, engineDevice: TtsDevice | undefined): boolean {
  return hasGpu && engineDevice !== 'wasm'
}

/** Turbo (extra GPU workers for preparing) is offered only for the Natural voice running on the GPU. */
export function showTurbo(hasGpu: boolean, voice: VoiceModel, engineDevice: TtsDevice | undefined): boolean {
  return voice === 'kokoro' && naturalOnGpu(hasGpu, engineDevice)
}

/** The device's WebGPU adapter check, as React state (null while asking). */
export function useHasGpu(): boolean | null {
  const [has, setHas] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    void gpuAvailable().then((v) => live && setHas(v))
    return () => {
      live = false
    }
  }, [])
  return has
}
