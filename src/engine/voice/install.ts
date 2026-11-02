import type { VoiceModel } from './types'
import { PIPER_VOICE } from './types'

/**
 * What is actually stored on this device for each voice, so the UI can say "On device" (and say "Loading" instead
 * of "Downloading" when a voice loads from storage after an app restart).
 * - Kokoro: transformers.js keeps model files in Cache Storage ('transformers-cache', keyed by URL); kokoro-js keeps
 *   the voice style file in 'kokoro-voices'.
 * - Piper: the piper library keeps files in the origin-private file system, folder 'piper'.
 */

const KOKORO_REPO = 'Kokoro-82M-v1.0-ONNX'
const KOKORO_FILES = { q8: 'onnx/model_quantized.onnx', fp32: 'onnx/model.onnx' } as const

/** Approximate download sizes, used before a voice is on the device. */
export const VOICE_DOWNLOAD_BYTES: Record<VoiceModel, number> = {
  kokoro: 92_400_000, // q8 (processor); the GPU variant is ~326 MB
  piper: 63_200_000,
}

export interface VoiceStorage {
  kokoro: { q8: boolean; fp32: boolean; bytes: number }
  piper: { installed: boolean; bytes: number }
}

async function kokoroCached(): Promise<{ q8: boolean; fp32: boolean; bytes: number }> {
  const out = { q8: false, fp32: false, bytes: 0 }
  if (typeof caches === 'undefined') return out
  try {
    const cache = await caches.open('transformers-cache')
    for (const req of await cache.keys()) {
      if (!req.url.includes(KOKORO_REPO)) continue
      const isQ8 = req.url.endsWith(KOKORO_FILES.q8)
      const isFp32 = req.url.endsWith(KOKORO_FILES.fp32)
      if (!isQ8 && !isFp32) continue
      if (isQ8) out.q8 = true
      if (isFp32) out.fp32 = true
      const len = Number((await cache.match(req))?.headers.get('content-length'))
      out.bytes += len > 0 ? len : isQ8 ? VOICE_DOWNLOAD_BYTES.kokoro : 326_000_000
    }
  } catch {
    /* Cache Storage unavailable */
  }
  return out
}

async function piperDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory()
    return await root.getDirectoryHandle('piper')
  } catch {
    return null
  }
}

async function piperStored(): Promise<{ installed: boolean; bytes: number }> {
  const dir = await piperDir()
  if (!dir) return { installed: false, bytes: 0 }
  try {
    const file = await (await dir.getFileHandle(`${PIPER_VOICE}.onnx`)).getFile()
    return { installed: file.size > 1_000_000, bytes: file.size }
  } catch {
    return { installed: false, bytes: 0 }
  }
}

export async function voiceStorage(): Promise<VoiceStorage> {
  const [kokoro, piper] = await Promise.all([kokoroCached(), piperStored()])
  return { kokoro, piper }
}

/** True if the voice's model is already on this device (any variant for Kokoro). */
export async function isVoiceInstalled(voice: VoiceModel): Promise<boolean> {
  if (voice === 'piper') return (await piperStored()).installed
  const k = await kokoroCached()
  return k.q8 || k.fp32
}

/** Delete a voice's files from this device (it downloads again on next use). */
export async function removeVoice(voice: VoiceModel): Promise<void> {
  if (voice === 'piper') {
    const dir = await piperDir()
    for (const name of [`${PIPER_VOICE}.onnx`, `${PIPER_VOICE}.onnx.json`]) await dir?.removeEntry(name).catch(() => {})
    return
  }
  if (typeof caches === 'undefined') return
  const cache = await caches.open('transformers-cache')
  for (const req of await cache.keys()) if (req.url.includes(KOKORO_REPO)) await cache.delete(req)
  await caches.delete('kokoro-voices')
}

/** Free space on the device, if the browser reports it. */
export async function freeBytes(): Promise<number | null> {
  try {
    const e = await navigator.storage.estimate()
    return e.quota !== undefined && e.usage !== undefined ? e.quota - e.usage : null
  } catch {
    return null
  }
}

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`
  return `${Math.max(1, Math.round(n / 1e6))} MB`
}
