import type { AppBlobUpload, AppFileMeta, DriveClient, DriveFileMeta } from './client'

interface FakeBlobFile {
  name: string
  blob: Blob
  appProperties: Record<string, string>
}

/** In-memory Google Drive stand-in for tests: shared between simulated devices. */
export class FakeDrive implements DriveClient {
  appFiles = new Map<string, { name: string; json: string }>()
  /** binary appDataFolder files (audio packs) */
  blobs = new Map<string, FakeBlobFile>()
  files = new Map<string, { meta: DriveFileMeta; blob: Blob }>()
  writes = 0
  /** bytes uploaded to binary files so far */
  uploadedBytes = 0
  uploads = 0
  downloads = 0
  /** make the next upload fail with this error (e.g. a quota error) */
  failNextUpload: Error | null = null
  /** stop answering (simulates going offline) until set back */
  offline = false
  private n = 0

  private check() {
    if (this.offline) throw new TypeError('Failed to fetch')
  }

  async findAppFile(name: string) {
    this.check()
    for (const [id, f] of this.appFiles) if (f.name === name) return { id }
    return null
  }
  async readAppFile(id: string) {
    this.check()
    const f = this.appFiles.get(id)
    if (!f) throw new Error('not found')
    return JSON.parse(f.json)
  }
  async createAppFile(name: string, data: unknown) {
    this.check()
    const id = `app${++this.n}`
    this.appFiles.set(id, { name, json: JSON.stringify(data) })
    this.writes++
    return { id }
  }
  async updateAppFile(id: string, data: unknown) {
    this.check()
    const f = this.appFiles.get(id)
    if (!f) throw new Error('not found')
    f.json = JSON.stringify(data)
    this.writes++
  }
  async listAppFiles(props: Record<string, string>): Promise<AppFileMeta[]> {
    this.check()
    const out: AppFileMeta[] = []
    for (const [id, f] of this.blobs) {
      if (Object.entries(props).every(([k, v]) => f.appProperties[k] === v)) out.push({ id, name: f.name, size: f.blob.size, appProperties: { ...f.appProperties } })
    }
    return out
  }
  async uploadAppBlob(file: AppBlobUpload, onProgress?: (sent: number, total: number) => void) {
    this.check()
    if (this.failNextUpload) {
      const e = this.failNextUpload
      this.failNextUpload = null
      throw e
    }
    if (file.id && !this.blobs.has(file.id)) throw new Error('not found')
    const id = file.id ?? `blob${++this.n}`
    this.blobs.set(id, { name: file.name, blob: file.blob, appProperties: { ...file.appProperties } })
    this.uploadedBytes += file.blob.size
    this.uploads++
    onProgress?.(file.blob.size, file.blob.size)
    return { id }
  }
  async deleteAppFile(id: string) {
    this.check()
    if (!this.blobs.delete(id) && !this.appFiles.delete(id)) throw new Error('not found')
  }
  async download(fileId: string) {
    this.check()
    const b = this.blobs.get(fileId)
    if (b) {
      this.downloads++
      return b.blob
    }
    const f = this.files.get(fileId)
    if (!f) throw new Error('not found')
    return f.blob
  }
  async getMeta(fileId: string) {
    this.check()
    const f = this.files.get(fileId)
    if (!f) throw new Error('not found')
    return f.meta
  }
}
