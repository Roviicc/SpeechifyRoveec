import type { BrowserContext, Route } from '@playwright/test'

/**
 * In-memory Google Drive REST API for e2e tests, shared by several browser contexts ("devices"): appDataFolder
 * listing with name / appProperties queries, multipart create + update, media download, delete.
 */
export interface StubFile {
  name: string
  appProperties: Record<string, string>
  body: Buffer
  mime: string
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Location, Range' }

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) })
}

/** Parts of a multipart/related body: [{headers, body}]. */
function multipart(body: Buffer, contentType: string): Array<{ type: string; body: Buffer }> {
  const boundary = /boundary=([^;]+)/.exec(contentType)?.[1]
  if (!boundary) return []
  const sep = Buffer.from(`--${boundary}`)
  const parts: Array<{ type: string; body: Buffer }> = []
  let at = body.indexOf(sep)
  while (at >= 0) {
    const start = at + sep.length
    if (body.subarray(start, start + 2).toString() === '--') break
    const next = body.indexOf(sep, start)
    if (next < 0) break
    const part = body.subarray(start + 2, next - 2) // skip CRLF after the boundary and before the next one
    const split = part.indexOf('\r\n\r\n')
    const headers = part.subarray(0, split).toString()
    parts.push({ type: /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1] ?? '', body: part.subarray(split + 4) })
    at = next
  }
  return parts
}

export class DriveStub {
  files = new Map<string, StubFile>()
  /** extra wait before answering a media download (to see the "downloading" state) */
  downloadDelayMs = 0
  downloads = 0
  private n = 0

  packs(): StubFile[] {
    return [...this.files.values()].filter((f) => f.appProperties.kind === 'lumen-audio')
  }

  async install(context: BrowserContext) {
    await context.route('https://www.googleapis.com/**', (route) => this.handle(route))
  }

  private async handle(route: Route) {
    const req = route.request()
    const url = new URL(req.url())
    const method = req.method()
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    if (req.headers()['authorization'] !== 'Bearer fake-token') return json(route, {}, 401)
    const idMatch = /\/files\/([^/?]+)/.exec(url.pathname)
    const id = idMatch?.[1]

    if (method === 'GET' && !id) {
      const q = url.searchParams.get('q') ?? ''
      const name = /name='([^']*)'/.exec(q)?.[1]
      const props = [...q.matchAll(/appProperties has \{ key='([^']*)' and value='([^']*)' \}/g)].map((m) => [m[1], m[2]])
      const files = [...this.files]
        .filter(([, f]) => (name === undefined || f.name === name) && props.every(([k, v]) => f.appProperties[k] === v))
        .map(([fid, f]) => ({ id: fid, name: f.name, size: String(f.body.length), appProperties: f.appProperties, modifiedTime: new Date().toISOString() }))
      return json(route, { files })
    }
    if (method === 'GET' && id) {
      const f = this.files.get(id)
      if (!f) return json(route, { error: { errors: [{ reason: 'notFound' }] } }, 404)
      if (url.searchParams.get('alt') === 'media') {
        if (f.appProperties.kind === 'lumen-audio') {
          this.downloads++
          if (this.downloadDelayMs) await new Promise((r) => setTimeout(r, this.downloadDelayMs))
        }
        return route.fulfill({ status: 200, headers: CORS, contentType: f.mime, body: f.body })
      }
      return json(route, { id, name: f.name, mimeType: f.mime })
    }
    if (method === 'DELETE' && id) {
      this.files.delete(id)
      return route.fulfill({ status: 204, headers: CORS, body: '' })
    }
    if (method === 'POST' || method === 'PATCH') {
      const body = req.postDataBuffer() ?? Buffer.alloc(0)
      const type = req.headers()['content-type'] ?? ''
      let meta: { name?: string; appProperties?: Record<string, string> } = {}
      let content = body
      let mime = type
      if (url.searchParams.get('uploadType') === 'multipart') {
        const [m, c] = multipart(body, type)
        meta = JSON.parse(m.body.toString())
        content = c.body
        mime = c.type
      }
      if (method === 'POST') {
        const fid = `stub${++this.n}`
        this.files.set(fid, { name: meta.name ?? 'untitled', appProperties: meta.appProperties ?? {}, body: content, mime })
        return json(route, { id: fid })
      }
      const f = id && this.files.get(id)
      if (!f) return json(route, { error: { errors: [{ reason: 'notFound' }] } }, 404)
      this.files.set(id, { name: meta.name ?? f.name, appProperties: { ...f.appProperties, ...(meta.appProperties ?? {}) }, body: content, mime })
      return json(route, { id })
    }
    return json(route, { error: { errors: [{ reason: 'unsupported' }] } }, 400)
  }
}

/** Run in the page before the app loads: signed in to Drive (stub token). */
export const SIGNED_IN = `
localStorage.setItem('lumen-gtoken', JSON.stringify({ value: 'fake-token', expiresAt: Date.now() + 3600000 }));
localStorage.setItem('lumen-drive-connected', '1');`

/** Run in the page before the app loads: pretend to be on this kind of network (Network Information API). */
export function network(type: 'wifi' | 'cellular') {
  return `Object.defineProperty(Navigator.prototype, 'connection', { configurable: true, get() {
    return { type: '${type}', saveData: false, addEventListener() {}, removeEventListener() {} };
  } });`
}
