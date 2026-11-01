export interface DriveFileMeta {
  id: string
  name: string
  mimeType: string
}

/** Everything the app needs from Google Drive (a FakeDrive implements it for tests). */
export interface DriveClient {
  findAppFile(name: string): Promise<{ id: string } | null>
  readAppFile(id: string): Promise<unknown>
  createAppFile(name: string, data: unknown): Promise<{ id: string }>
  updateAppFile(id: string, data: unknown): Promise<void>
  download(fileId: string): Promise<Blob>
  getMeta(fileId: string): Promise<DriveFileMeta>
}

export class DriveAuthError extends Error {
  constructor(message = 'Google sign-in expired') {
    super(message)
    this.name = 'DriveAuthError'
  }
}

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'

export class GoogleDriveClient implements DriveClient {
  constructor(private readonly token: () => Promise<string>) {}

  private async req(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${await this.token()}` } })
    if (res.status === 401) throw new DriveAuthError()
    if (!res.ok) throw new Error(`Google Drive error ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return res
  }

  async findAppFile(name: string) {
    const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and trashed=false`)
    const res = await this.req(`${API}/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&pageSize=10`)
    const json = (await res.json()) as { files: Array<{ id: string }> }
    return json.files[0] ?? null
  }

  async readAppFile(id: string) {
    return (await this.req(`${API}/files/${id}?alt=media`)).json()
  }

  async createAppFile(name: string, data: unknown) {
    const boundary = `lumen${Math.random().toString(36).slice(2)}`
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ name, parents: ['appDataFolder'], mimeType: 'application/json' }) +
      `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
      JSON.stringify(data) +
      `\r\n--${boundary}--`
    const res = await this.req(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    })
    return (await res.json()) as { id: string }
  }

  async updateAppFile(id: string, data: unknown) {
    await this.req(`${UPLOAD}/files/${id}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  }

  async download(fileId: string) {
    return (await this.req(`${API}/files/${fileId}?alt=media`)).blob()
  }

  async getMeta(fileId: string) {
    return (await (await this.req(`${API}/files/${fileId}?fields=id,name,mimeType`)).json()) as DriveFileMeta
  }
}
