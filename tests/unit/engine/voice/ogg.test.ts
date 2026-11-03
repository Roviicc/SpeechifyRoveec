import { describe, expect, it } from 'vitest'
import { muxOggOpus, oggCrc, opusPacketSamples } from '@/engine/voice/player/ogg'
import { compressWav, decodeWav } from '@/engine/voice/player/opus'
import { encodeWav } from '@/engine/voice/player/wav'

interface Page {
  type: number
  granule: number
  seq: number
  packets: Uint8Array[]
  crcOk: boolean
}

function parse(bytes: Uint8Array): Page[] {
  const pages: Page[] = []
  let o = 0
  while (o < bytes.length) {
    const v = new DataView(bytes.buffer, bytes.byteOffset + o)
    expect(String.fromCharCode(...bytes.subarray(o, o + 4))).toBe('OggS')
    const nseg = bytes[o + 26]
    const lacing = bytes.subarray(o + 27, o + 27 + nseg)
    const len = 27 + nseg + lacing.reduce((a, b) => a + b, 0)
    const copy = bytes.slice(o, o + len)
    copy.fill(0, 22, 26)
    const crcOk = oggCrc(copy) === v.getUint32(22, true)
    const packets: Uint8Array[] = []
    let p = o + 27 + nseg
    let cur = 0
    let start = p
    for (const l of lacing) {
      cur += l
      p += l
      if (l < 255) {
        packets.push(bytes.slice(start, start + cur))
        start = p
        cur = 0
      }
    }
    pages.push({ type: bytes[o + 5], granule: v.getUint32(6, true) + v.getUint32(10, true) * 2 ** 32, seq: v.getUint32(18, true), packets, crcOk })
    o += len
  }
  return pages
}

describe('Ogg Opus muxer', () => {
  it('counts samples per packet from the TOC byte', () => {
    expect(opusPacketSamples(new Uint8Array([(31 << 3) | 0]))).toBe(960) // CELT 20 ms, 1 frame
    expect(opusPacketSamples(new Uint8Array([(1 << 3) | 1]))).toBe(1920) // SILK 20 ms, 2 frames
    expect(opusPacketSamples(new Uint8Array([(16 << 3) | 3, 4]))).toBe(480) // CELT 2.5 ms x 4
  })

  it('writes OpusHead, OpusTags and audio pages with valid CRCs and a trimmed final granule', () => {
    const packet = (n: number) => {
      const p = new Uint8Array(n)
      p[0] = 31 << 3 // 20 ms CELT
      return p
    }
    const packets = Array.from({ length: 120 }, (_, i) => packet(i === 5 ? 600 : 60))
    // 2.37 s at 24 kHz
    const frames = Math.round(2.37 * 24000)
    const ogg = muxOggOpus(packets, { preSkip: 312, inputRate: 24000, frames })
    const pages = parse(ogg)
    expect(pages.every((p) => p.crcOk)).toBe(true)
    expect(pages.map((p) => p.seq)).toEqual(pages.map((_, i) => i))
    expect(new TextDecoder().decode(pages[0].packets[0].subarray(0, 8))).toBe('OpusHead')
    expect(pages[0].type).toBe(2)
    expect(new DataView(pages[0].packets[0].buffer).getUint16(10, true)).toBe(312)
    expect(new TextDecoder().decode(pages[1].packets[0].subarray(0, 8))).toBe('OpusTags')
    const audio = pages.slice(2)
    expect(audio.flatMap((p) => p.packets.map((x) => x.length))).toEqual(packets.map((p) => p.length))
    expect(audio.at(-1)!.type).toBe(4)
    expect(audio.at(-1)!.granule).toBe(312 + Math.round(2.37 * 48000))
    // granules grow
    for (let i = 1; i < audio.length; i++) expect(audio[i].granule).toBeGreaterThan(audio[i - 1].granule)
  })

  it('decodes its own WAV files; without WebCodecs the WAV is kept as is', async () => {
    const samples = new Float32Array([0, 0.5, -0.5, 0.25])
    const wav = encodeWav(samples, 24000)
    const back = decodeWav(wav)!
    expect(back.sampleRate).toBe(24000)
    expect(Array.from(back.samples).map((x) => Math.round(x * 100) / 100)).toEqual([0, 0.5, -0.5, 0.25])
    const blob = new Blob([wav], { type: 'audio/wav' })
    expect(await compressWav(blob)).toBe(blob)
  })
})
