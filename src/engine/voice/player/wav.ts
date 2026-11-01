/** Encode mono float samples as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  let o = 44
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buf
}

/** Trim leading/trailing near-silence, keeping a small pad, so sentences join without long gaps. */
export function trimSilence(samples: Float32Array, sampleRate: number, threshold = 0.004, padMs = 60): Float32Array {
  let a = 0
  let b = samples.length - 1
  while (a < b && Math.abs(samples[a]) < threshold) a++
  while (b > a && Math.abs(samples[b]) < threshold) b--
  const pad = Math.round((padMs / 1000) * sampleRate)
  return samples.subarray(Math.max(0, a - pad), Math.min(samples.length, b + pad * 2))
}
