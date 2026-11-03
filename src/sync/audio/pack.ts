import { hashText } from '@/data/util'

/**
 * An audio pack: the prepared audio of one chapter range, as one file in the Drive appDataFolder.
 *
 *   bytes 0..3   "LMAP" (Lumen audio pack)
 *   bytes 4..7   header length N (uint32, little endian)
 *   bytes 8..    N bytes of UTF-8 JSON (PackHeader)
 *   then         the sentences' audio blobs back to back (entry.offset is relative to here)
 *
 * The same facts the listing needs (book, voice, range, entry count, contentSig) are also on the Drive file as
 * appProperties, so a device can see what is in Drive without downloading anything.
 */
export const PACK_FORMAT = 1
const MAGIC = 'LMAP'

export interface PackEntry {
  /** sentence index in the book's sentence list */
  index: number
  /** hash of the spoken text alone (matches any voice) */
  textHash: string
  /** the audio cache's voice-mixed hash (audioHash(voice, text)) */
  hash: string
  voice: string
  /** seconds (the original PCM duration, used for word timing) */
  duration: number
  offset: number
  length: number
  mime: string
}

export interface PackHeader {
  format: number
  bookId: string
  /** voice of most entries */
  voice: string
  /** sentence range of the pack (inclusive) */
  from: number
  to: number
  entries: PackEntry[]
}

export interface PackInput {
  index: number
  textHash: string
  hash: string
  voice: string
  duration: number
  blob: Blob
}

export interface DecodedEntry extends PackEntry {
  blob: Blob
}

/** Fingerprint of a pack's content: equal packs are not uploaded again. */
export function packSig(entries: Array<Pick<PackEntry, 'index' | 'hash' | 'textHash' | 'duration'> & { length: number }>): string {
  const sorted = [...entries].sort((a, b) => a.index - b.index)
  const bytes = sorted.reduce((a, e) => a + e.length, 0)
  const body = JSON.stringify(sorted.map((e) => [e.index, e.hash, e.textHash, e.length, Math.round(e.duration * 1000)]))
  return `${hashText(body)}${hashText(body.split('').reverse().join(''))}-${sorted.length}-${bytes}`
}

function mostCommon(values: string[]): string {
  const n = new Map<string, number>()
  let best = ''
  for (const v of values) {
    const c = (n.get(v) ?? 0) + 1
    n.set(v, c)
    if (c > (n.get(best) ?? 0)) best = v
  }
  return best
}

export function encodePack(meta: { bookId: string; from: number; to: number }, inputs: PackInput[]): { blob: Blob; header: PackHeader; sig: string } {
  const sorted = [...inputs].sort((a, b) => a.index - b.index)
  let offset = 0
  const entries: PackEntry[] = sorted.map((it) => {
    const e: PackEntry = {
      index: it.index,
      textHash: it.textHash,
      hash: it.hash,
      voice: it.voice,
      duration: it.duration,
      offset,
      length: it.blob.size,
      mime: it.blob.type || 'application/octet-stream',
    }
    offset += it.blob.size
    return e
  })
  const header: PackHeader = { format: PACK_FORMAT, bookId: meta.bookId, voice: mostCommon(entries.map((e) => e.voice)), from: meta.from, to: meta.to, entries }
  const json = new TextEncoder().encode(JSON.stringify(header))
  const head = new Uint8Array(8)
  head.set(new TextEncoder().encode(MAGIC), 0)
  new DataView(head.buffer).setUint32(4, json.length, true)
  const blob = new Blob([head, json, ...sorted.map((it) => it.blob)], { type: 'application/octet-stream' })
  return { blob, header, sig: packSig(entries) }
}

export class PackFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PackFormatError'
  }
}

export async function decodePack(blob: Blob): Promise<{ header: PackHeader; entries: DecodedEntry[] }> {
  if (blob.size < 8) throw new PackFormatError('Audio pack is too short')
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer())
  if (new TextDecoder().decode(head.slice(0, 4)) !== MAGIC) throw new PackFormatError('Not a Lumen audio pack')
  const len = new DataView(head.buffer).getUint32(4, true)
  if (8 + len > blob.size) throw new PackFormatError('Audio pack header is cut off')
  const header = JSON.parse(new TextDecoder().decode(await blob.slice(8, 8 + len).arrayBuffer())) as PackHeader
  if (header.format > PACK_FORMAT) throw new PackFormatError('This audio pack was made by a newer version of Lumen')
  const base = 8 + len
  const entries = header.entries.map((e) => {
    if (base + e.offset + e.length > blob.size) throw new PackFormatError('Audio pack is cut off')
    return { ...e, blob: blob.slice(base + e.offset, base + e.offset + e.length, e.mime) }
  })
  return { header, entries }
}

/** Drive appProperties of a pack (all strings; Drive limits each key+value to 124 bytes). */
export const PACK_KIND = 'lumen-audio'

export interface RemotePack {
  id: string
  bookId: string
  voice: string
  from: number
  to: number
  entries: number
  sig: string
  size: number
}

export function packProperties(header: PackHeader, sig: string): Record<string, string> {
  return {
    kind: PACK_KIND,
    format: String(header.format),
    bookId: header.bookId,
    voice: header.voice,
    from: String(header.from),
    to: String(header.to),
    entries: String(header.entries.length),
    sig,
  }
}

export function parsePackProperties(file: { id: string; size: number; appProperties: Record<string, string> }): RemotePack | null {
  const p = file.appProperties
  if (p.kind !== PACK_KIND || !p.bookId) return null
  const from = Number(p.from)
  const to = Number(p.to)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  return { id: file.id, bookId: p.bookId, voice: p.voice ?? '', from, to, entries: Number(p.entries) || 0, sig: p.sig ?? '', size: file.size }
}

export function packName(bookId: string, from: number, to: number): string {
  return `audio-${bookId}-${from}-${to}.lmap`
}
