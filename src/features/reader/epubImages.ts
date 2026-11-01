import type JSZip from 'jszip'
import { getFile } from '../../data/repo'

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
}

/**
 * Resolves EPUB image paths to object URLs. The EPUB file is read from IndexedDB and unzipped lazily on
 * the first request; `dispose()` revokes every URL created so far (call it on unmount). The object stays
 * usable after dispose (React StrictMode re-runs effects), it just starts over.
 */
export class EpubImages {
  private zip: Promise<JSZip | null> | null = null
  private urls = new Map<string, Promise<string | null>>()
  private created: string[] = []
  private generation = 0
  constructor(
    readonly bookId: string,
    private loadFile: (id: string) => Promise<Blob | null> = getFile,
  ) {}

  url(path: string): Promise<string | null> {
    if (path.startsWith('data:')) return Promise.resolve(path)
    let p = this.urls.get(path)
    if (!p) {
      const gen = this.generation
      this.zip ??= this.loadFile(this.bookId)
        .then(async (blob) => (blob ? (await import('jszip')).default.loadAsync(blob) : null))
        .catch(() => null)
      p = this.zip.then(async (zip) => {
        const f = zip?.file(path) ?? zip?.file(decodeURIComponent(path))
        if (!f) return null
        const ext = path.split('.').pop()?.toLowerCase() ?? ''
        const blob = new Blob([await f.async('arraybuffer')], { type: MIME[ext] ?? 'application/octet-stream' })
        if (gen !== this.generation) return null
        const u = URL.createObjectURL(blob)
        this.created.push(u)
        return u
      })
      this.urls.set(path, p)
    }
    return p
  }

  dispose() {
    this.generation++
    for (const u of this.created) URL.revokeObjectURL(u)
    this.created = []
    this.urls.clear()
    this.zip = null
  }
}
