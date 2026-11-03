/**
 * Minimal Ogg Opus muxer (RFC 3533 pages + RFC 7845 Opus mapping), so raw Opus packets from WebCodecs'
 * AudioEncoder become a file that <audio> and decodeAudioData both play. Mono only.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let r = i << 24
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1
    t[i] = r >>> 0
  }
  return t
})()

/** Ogg's CRC-32 (polynomial 0x04c11db7, not reflected, initial value 0). */
export function oggCrc(bytes: Uint8Array): number {
  let crc = 0
  for (let i = 0; i < bytes.length; i++) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ bytes[i]) & 0xff]) >>> 0
  return crc >>> 0
}

/** Samples (at 48 kHz) in one Opus packet, from its TOC byte (RFC 6716 section 3.1). */
export function opusPacketSamples(packet: Uint8Array): number {
  if (!packet.length) return 0
  const toc = packet[0]
  const config = toc >> 3
  let frameMs: number
  if (config < 12) frameMs = [10, 20, 40, 60][config % 4]
  else if (config < 16) frameMs = [10, 20][config % 2]
  else frameMs = [2.5, 5, 10, 20][config % 4]
  const code = toc & 3
  const frames = code === 0 ? 1 : code < 3 ? 2 : (packet[1] ?? 0) & 0x3f
  return Math.round(frameMs * 48) * frames
}

const HEADER_TYPE = { continued: 1, first: 2, last: 4 }

function page(packets: Uint8Array[], granule: number, serial: number, seq: number, type: number): Uint8Array {
  const lacing: number[] = []
  for (const p of packets) {
    let n = p.length
    while (n >= 255) {
      lacing.push(255)
      n -= 255
    }
    lacing.push(n)
  }
  const body = packets.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(27 + lacing.length + body)
  const v = new DataView(out.buffer)
  out.set([0x4f, 0x67, 0x67, 0x53]) // "OggS"
  out[4] = 0
  out[5] = type
  v.setUint32(6, granule >>> 0, true)
  v.setUint32(10, Math.floor(granule / 2 ** 32), true)
  v.setUint32(14, serial, true)
  v.setUint32(18, seq, true)
  out[26] = lacing.length
  out.set(lacing, 27)
  let o = 27 + lacing.length
  for (const p of packets) {
    out.set(p, o)
    o += p.length
  }
  v.setUint32(22, oggCrc(out), true)
  return out
}

function opusHead(preSkip: number, inputRate: number): Uint8Array {
  const b = new Uint8Array(19)
  const v = new DataView(b.buffer)
  b.set(new TextEncoder().encode('OpusHead'))
  b[8] = 1 // version
  b[9] = 1 // channels
  v.setUint16(10, preSkip, true)
  v.setUint32(12, inputRate, true)
  v.setInt16(16, 0, true) // output gain
  b[18] = 0 // mapping family
  return b
}

function opusTags(): Uint8Array {
  const vendor = new TextEncoder().encode('Lumen')
  const b = new Uint8Array(8 + 4 + vendor.length + 4)
  const v = new DataView(b.buffer)
  b.set(new TextEncoder().encode('OpusTags'))
  v.setUint32(8, vendor.length, true)
  b.set(vendor, 12)
  v.setUint32(12 + vendor.length, 0, true)
  return b
}

export interface OggOpusOptions {
  /** decoder samples (48 kHz) to drop at the start (encoder delay) */
  preSkip: number
  /** original sample rate (informational) */
  inputRate: number
  /** exact length of the original audio in input-rate samples: the end padding is trimmed with the last granule */
  frames: number
}

/** Wrap Opus packets into an Ogg Opus file. */
export function muxOggOpus(packets: Uint8Array[], opts: OggOpusOptions): Uint8Array {
  const serial = 0x4c756d6e // "Lumn"
  const pages: Uint8Array[] = [page([opusHead(opts.preSkip, opts.inputRate)], 0, serial, 0, HEADER_TYPE.first), page([opusTags()], 0, serial, 1, 0)]
  const end = opts.preSkip + Math.round((opts.frames * 48000) / opts.inputRate)
  let granule = 0
  let seq = 2
  let batch: Uint8Array[] = []
  let segs = 0
  const flush = (last: boolean) => {
    if (!batch.length && !last) return
    pages.push(page(batch, last ? Math.min(granule, end) : granule, serial, seq++, last ? HEADER_TYPE.last : 0))
    batch = []
    segs = 0
  }
  packets.forEach((p) => {
    const need = Math.floor(p.length / 255) + 1
    // keep pages small (~1 s of audio) so players can seek; a page holds at most 255 lacing values
    if (segs + need > 255 || batch.length >= 50) flush(false)
    batch.push(p)
    segs += need
    granule += opusPacketSamples(p)
  })
  flush(true)
  const total = pages.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of pages) {
    out.set(p, o)
    o += p.length
  }
  return out
}
