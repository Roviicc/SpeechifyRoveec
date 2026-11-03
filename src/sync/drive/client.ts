export interface DriveFileMeta {
  id: string
  name: string
  mimeType: string
}

/** A file in the hidden appDataFolder, with the properties it was tagged with (listing needs no download). */
export interface AppFileMeta {
  id: string
  name: string
  size: number
  appProperties: Record<string, string>
}

export interface AppBlobUpload {
  /** replace this file's content and properties (else a new file is created) */
  id?: string
  name: string
  blob: Blob
  appProperties: Record<string, string>
}

/** Everything the app needs from Google Drive (a FakeDrive implements it for tests). */
export interface DriveClient {
  findAppFile(name: string): Promise<{ id: string } | null>
  /** appDataFolder files whose appProperties include all of `props` */
  listAppFiles(props: Record<string, string>): Promise<AppFileMeta[]>
  /** create or replace a binary appDataFolder file (multipart when small, resumable in chunks when large) */
  uploadAppBlob(file: AppBlobUpload, onProgress?: (sent: number, total: number) => void): Promise<{ id: string }>
  deleteAppFile(id: string): Promise<void>
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

/** A Drive request that failed: `reason` is Google's error reason (e.g. storageQuotaExceeded). */
export class DriveHttpError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    message: string,
  ) {
    super(message)
    this.name = 'DriveHttpError'
  }
  /** the user's Drive is full */
  get quotaFull(): boolean {
    return this.reason === 'storageQuotaExceeded'
  }
  /** worth trying again later (rate limit, server trouble) */
  get transient(): boolean {
    return this.status === 429 || this.status >= 500 || this.reason === 'userRateLimitExceeded' || this.reason === 'rateLimitExceeded'
  }
}

async function httpError(res: Response): Promise<DriveHttpError> {
  const text = await res.text().catch(() => '')
  let reason = ''
  try {
    reason = (JSON.parse(text) as { error?: { errors?: Array<{ reason?: string }> } }).error?.errors?.[0]?.reason ?? ''
  } catch {
    // not JSON
  }
  return new DriveHttpError(res.status, reason, `Google Drive error ${res.status}: ${text.slice(0, 200)}`)
}

/** Files up to this size go in one multipart request; bigger ones are uploaded resumably in chunks. */
export const MULTIPART_LIMIT = 5 * 1024 * 1024
/** Resumable chunk size (a multiple of 256 KiB, as Drive requires). */
export const UPLOAD_CHUNK = 8 * 1024 * 1024

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'

export class GoogleDriveClient implements DriveClient {
  constructor(private readonly token: () => Promise<string>) {}

  private async req(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${await this.token()}` } })
    if (res.status === 401) throw new DriveAuthError()
    // 308 = resumable upload: "resume incomplete" (more chunks expected)
    if (!res.ok && res.status !== 308) throw await httpError(res)
    return res
  }

  async listAppFiles(props: Record<string, string>) {
    const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    const terms = Object.entries(props).map(([k, v]) => `appProperties has { key='${esc(k)}' and value='${esc(v)}' }`)
    const q = encodeURIComponent([...terms, 'trashed=false'].join(' and '))
    const out: AppFileMeta[] = []
    let page = ''
    do {
      const res = await this.req(
        `${API}/files?spaces=appDataFolder&q=${q}&fields=nextPageToken,files(id,name,size,appProperties)&pageSize=1000${page ? `&pageToken=${page}` : ''}`,
      )
      const json = (await res.json()) as { nextPageToken?: string; files: Array<{ id: string; name: string; size?: string; appProperties?: Record<string, string> }> }
      for (const f of json.files ?? []) out.push({ id: f.id, name: f.name, size: Number(f.size) || 0, appProperties: f.appProperties ?? {} })
      page = json.nextPageToken ?? ''
    } while (page)
    return out
  }

  async uploadAppBlob(file: AppBlobUpload, onProgress?: (sent: number, total: number) => void) {
    const meta: Record<string, unknown> = { name: file.name, appProperties: file.appProperties }
    if (!file.id) meta.parents = ['appDataFolder']
    const type = file.blob.type || 'application/octet-stream'
    const total = file.blob.size
    const target = file.id ? `${UPLOAD}/files/${file.id}` : `${UPLOAD}/files`
    const method = file.id ? 'PATCH' : 'POST'
    if (total <= MULTIPART_LIMIT) {
      const boundary = `lumen${Math.random().toString(36).slice(2)}`
      const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`,
        file.blob,
        `\r\n--${boundary}--`,
      ])
      const res = await this.req(`${target}?uploadType=multipart&fields=id`, {
        method,
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      })
      onProgress?.(total, total)
      return (await res.json()) as { id: string }
    }
    // resumable: open a session, then send chunks; after a failed chunk ask Drive how much it has and go on from there
    const start = await this.req(`${target}?uploadType=resumable&fields=id`, {
      method,
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type, 'X-Upload-Content-Length': String(total) },
      body: JSON.stringify(meta),
    })
    const session = start.headers.get('Location')
    if (!session) throw new Error('Google Drive did not start the upload')
    let sent = 0
    let failures = 0
    while (sent < total) {
      const end = Math.min(total, sent + UPLOAD_CHUNK)
      let res: Response
      try {
        res = await this.req(session, { method: 'PUT', headers: { 'Content-Range': `bytes ${sent}-${end - 1}/${total}` }, body: file.blob.slice(sent, end) })
      } catch (e) {
        if (e instanceof DriveAuthError || (e instanceof DriveHttpError && !e.transient) || ++failures > 4) throw e
        await new Promise((r) => setTimeout(r, 1000 * 2 ** failures))
        const st = await this.req(session, { method: 'PUT', headers: { 'Content-Range': `bytes */${total}` } })
        if (st.status !== 308) return (await st.json()) as { id: string }
        sent = rangeEnd(st.headers.get('Range'))
        continue
      }
      if (res.status !== 308) {
        onProgress?.(total, total)
        return (await res.json()) as { id: string }
      }
      sent = rangeEnd(res.headers.get('Range')) || end
      onProgress?.(sent, total)
    }
    throw new Error('Google Drive upload did not finish')
  }

  async deleteAppFile(id: string) {
    await this.req(`${API}/files/${id}`, { method: 'DELETE' })
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

/** Bytes Drive has received, from a resumable upload's `Range: bytes=0-N` header (0 when absent). */
function rangeEnd(range: string | null): number {
  const m = range && /bytes=0-(\d+)/.exec(range)
  return m ? Number(m[1]) + 1 : 0
}
