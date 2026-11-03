import { muxOggOpus } from './ogg'

/** Speech at 24 kbit/s mono Opus: ~0.18 MB per minute (16-bit 24 kHz WAV is ~2.9 MB). */
export const OPUS_BITRATE = 24_000
export const OPUS_MIME = 'audio/ogg; codecs=opus'
/** libopus encoder delay (6.5 ms at 48 kHz), used when the encoder doesn't report its own pre-skip. */
const DEFAULT_PRE_SKIP = 312

/** Decode a 16-bit PCM mono WAV (as made by encodeWav) back to float samples. */
export function decodeWav(buf: ArrayBuffer): { samples: Float32Array; sampleRate: number } | null {
  const v = new DataView(buf)
  if (buf.byteLength < 44 || v.getUint32(0, false) !== 0x52494646 /* RIFF */) return null
  let o = 12
  let sampleRate = 0
  let bits = 0
  let channels = 0
  while (o + 8 <= buf.byteLength) {
    const id = v.getUint32(o, false)
    const size = v.getUint32(o + 4, true)
    if (id === 0x666d7420 /* fmt  */) {
      channels = v.getUint16(o + 10, true)
      sampleRate = v.getUint32(o + 12, true)
      bits = v.getUint16(o + 22, true)
    } else if (id === 0x64617461 /* data */) {
      if (bits !== 16 || channels !== 1 || !sampleRate) return null
      const n = Math.floor(Math.min(size, buf.byteLength - o - 8) / 2)
      const samples = new Float32Array(n)
      for (let i = 0; i < n; i++) samples[i] = v.getInt16(o + 8 + i * 2, true) / 0x8000
      return { samples, sampleRate }
    }
    o += 8 + size + (size & 1)
  }
  return null
}

let support: Promise<boolean> | null = null

/** Whether this browser can encode Opus with WebCodecs (Chrome / Android Chrome yes; secure context required). */
export function opusSupported(sampleRate = 24000): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return Promise.resolve(false)
  support ??= AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate, numberOfChannels: 1, bitrate: OPUS_BITRATE })
    .then((r) => !!r.supported)
    .catch(() => false)
  return support
}

/** OpusHead in the encoder's decoder description carries its real pre-skip. */
function preSkipOf(desc: AllowSharedBufferSource | undefined): number | null {
  if (!desc) return null
  const bytes = ArrayBuffer.isView(desc) ? new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength) : new Uint8Array(desc)
  if (bytes.length < 12 || new TextDecoder().decode(bytes.subarray(0, 8)) !== 'OpusHead') return null
  return bytes[10] | (bytes[11] << 8)
}

/** Encode mono float samples as Ogg Opus. Resolves null when WebCodecs Opus is not available. */
export async function encodeOpus(samples: Float32Array, sampleRate: number, bitrate = OPUS_BITRATE): Promise<Blob | null> {
  if (!(await opusSupported())) return null
  const packets: Uint8Array[] = []
  let preSkip: number | null = null
  let failure: unknown = null
  const enc = new AudioEncoder({
    output: (chunk, meta) => {
      const b = new Uint8Array(chunk.byteLength)
      chunk.copyTo(b)
      packets.push(b)
      preSkip ??= preSkipOf(meta?.decoderConfig?.description)
    },
    error: (e) => (failure = e),
  })
  try {
    enc.configure({ codec: 'opus', sampleRate, numberOfChannels: 1, bitrate })
    const step = sampleRate // feed one second at a time
    for (let o = 0; o < samples.length; o += step) {
      const part = samples.slice(o, Math.min(samples.length, o + step))
      const data = new AudioData({ format: 'f32-planar', sampleRate, numberOfChannels: 1, numberOfFrames: part.length, timestamp: Math.round((o / sampleRate) * 1e6), data: part })
      enc.encode(data)
      data.close()
    }
    await enc.flush()
  } catch (e) {
    failure ??= e
  } finally {
    if (enc.state !== 'closed') enc.close()
  }
  if (failure || !packets.length) return null
  const ogg = muxOggOpus(packets, { preSkip: preSkip ?? DEFAULT_PRE_SKIP, inputRate: sampleRate, frames: samples.length })
  return new Blob([ogg as BlobPart], { type: OPUS_MIME })
}

/** Compress a WAV blob to Ogg Opus; returns the original blob when that is not possible. */
export async function compressWav(blob: Blob): Promise<Blob> {
  if (!/wav/.test(blob.type) || !(await opusSupported())) return blob
  try {
    const pcm = decodeWav(await blob.arrayBuffer())
    if (!pcm || !pcm.samples.length) return blob
    const opus = await encodeOpus(pcm.samples, pcm.sampleRate)
    return opus && opus.size < blob.size ? opus : blob
  } catch {
    return blob
  }
}
