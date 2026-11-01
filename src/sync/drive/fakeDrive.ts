import type { DriveClient, DriveFileMeta } from './client'

/** In-memory Google Drive stand-in for tests: shared between simulated devices. */
export class FakeDrive implements DriveClient {
  appFiles = new Map<string, { name: string; json: string }>()
  files = new Map<string, { meta: DriveFileMeta; blob: Blob }>()
  writes = 0
  private n = 0

  async findAppFile(name: string) {
    for (const [id, f] of this.appFiles) if (f.name === name) return { id }
    return null
  }
  async readAppFile(id: string) {
    const f = this.appFiles.get(id)
    if (!f) throw new Error('not found')
    return JSON.parse(f.json)
  }
  async createAppFile(name: string, data: unknown) {
    const id = `app${++this.n}`
    this.appFiles.set(id, { name, json: JSON.stringify(data) })
    this.writes++
    return { id }
  }
  async updateAppFile(id: string, data: unknown) {
    const f = this.appFiles.get(id)
    if (!f) throw new Error('not found')
    f.json = JSON.stringify(data)
    this.writes++
  }
  async download(fileId: string) {
    const f = this.files.get(fileId)
    if (!f) throw new Error('not found')
    return f.blob
  }
  async getMeta(fileId: string) {
    const f = this.files.get(fileId)
    if (!f) throw new Error('not found')
    return f.meta
  }
}
