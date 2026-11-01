import { CELL_SEP, type Block, type Mark, type MarkKind } from './types'

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'caption', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure',
  'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section',
  'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul', 'center', 'hgroup',
])
const SKIP_TAGS = new Set(['script', 'style', 'head', 'title', 'math', 'noscript', 'template', 'rt', 'rp'])

const MARK_TAGS: Record<string, MarkKind> = {
  i: 'i', em: 'i', cite: 'i', dfn: 'i', var: 'i',
  b: 'b', strong: 'b',
  sup: 'sup', sub: 'sub',
  code: 'code', kbd: 'code', samp: 'code', tt: 'code',
}

const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|svg|avif|bmp)$/i
const HAS_TEXT = /[\p{L}\p{N}]/u

function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i + 1)
}

/** Resolve `href` relative to the file at `base` inside the zip. */
export function resolvePath(base: string, href: string): string {
  const clean = decodeURIComponent(href.split('#')[0])
  const parts = (clean.startsWith('/') ? clean.slice(1) : dirOf(base) + clean).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p !== '.' && p !== '') out.push(p)
  }
  return out.join('/')
}

export function byLocalName(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter((e) => e.localName === name)
}

function isNoteRef(el: Element): boolean {
  const type = `${el.getAttribute('epub:type') ?? ''} ${el.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ?? ''} ${el.getAttribute('role') ?? ''}`
  if (/noteref/.test(type)) return true
  const text = (el.textContent ?? '').trim()
  if (el.localName === 'sup' && text.length <= 4 && /^[[(]?[\d*†‡§a-z]{1,3}[\])]?$/i.test(text)) return true
  if (el.localName === 'a' && (el.getAttribute('href') ?? '').includes('#') && /^\[?\d{1,3}\]?$/.test(text)) {
    return el.parentElement?.localName === 'sup' || /^\[\d+\]$/.test(text)
  }
  return false
}

/** Inline formatting of an element from its tag, class names and inline style (stylesheets are not parsed). */
function markOf(el: Element, tag: string): MarkKind | null {
  if (MARK_TAGS[tag]) return MARK_TAGS[tag]
  const cls = el.getAttribute('class') ?? ''
  const style = (el.getAttribute('style') ?? '').toLowerCase()
  if (/small-?caps|\bsc\b/i.test(cls) || /font-variant[^;]*small-caps/.test(style)) return 'sc'
  if (/\bital(?:ic)?s?\b|\bemph/i.test(cls) || /font-style\s*:\s*italic/.test(style)) return 'i'
  if (/\bbold\b/i.test(cls) || /font-weight\s*:\s*(?:bold|[6-9]00)/.test(style)) return 'b'
  return null
}

function listLabel(n: number, type: string): string {
  if (type === 'a' || type === 'A') {
    let s = ''
    let k = n
    while (k > 0) {
      s = String.fromCharCode(97 + ((k - 1) % 26)) + s
      k = Math.floor((k - 1) / 26)
    }
    return type === 'A' ? s.toUpperCase() : s
  }
  if (type === 'i' || type === 'I') {
    const table: Array<[number, string]> = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
    let r = ''
    let k = n
    for (const [v, s] of table) {
      while (k >= v) {
        r += s
        k -= v
      }
    }
    return type === 'I' ? r.toUpperCase() : r
  }
  return String(n)
}

interface Ctx {
  kind: 'p' | 'h'
  level?: 1 | 2 | 3
  indent: number
  quote: boolean
  pre: boolean
  caption: boolean
  /** inside a table cell: everything is inline */
  cell: boolean
}

const ROOT: Ctx = { kind: 'p', indent: 0, quote: false, pre: false, caption: false, cell: false }

export interface ExtractOptions {
  /** zip path of the XHTML file, used to resolve image hrefs */
  base?: string
}

/**
 * Extract blocks (paragraphs, headings, list items, table rows, images) from an XHTML body.
 * Text is whitespace-collapsed; `<br>` and `<pre>` line breaks are kept as '\n'. Inline styles are kept
 * as `marks` ranges, so the reader renders several text nodes whose concatenation is exactly `text`.
 */
export function extractBlocks(body: Element, opts: ExtractOptions = {}): Block[] {
  const blocks: Block[] = []
  let buf = ''
  let notes: Array<[number, number]> = []
  let marks: Mark[] = []
  let ids: string[] = []
  let inNote = false
  let pendingLi: string | undefined
  /** images found in the middle of a paragraph: emitted right after it, so its text stays one block */
  let queued: Block[] = []

  const append = (raw: string, ctx: Ctx) => {
    if (ctx.pre) {
      let t = raw.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/\u00a0/g, ' ')
      if (!buf) t = t.replace(/^\n+/, '')
      buf += t
      return
    }
    let t = raw.replace(/[\s\u00a0]+/g, ' ')
    if (!buf || buf.endsWith(' ') || buf.endsWith('\n')) t = t.replace(/^ /, '')
    buf += t
  }
  const lineBreak = () => {
    if (buf.endsWith(' ')) buf = buf.slice(0, -1)
    if (buf && !buf.endsWith('\n\n')) buf += '\n'
  }
  const trimRange = (text: string, s: number, e: number): [number, number] => {
    e = Math.min(e, text.length)
    while (s < e && /\s/.test(text[s])) s++
    while (e > s && /\s/.test(text[e - 1])) e--
    return [s, e]
  }
  /** Push the buffered text as a block (if it has any letters/digits); returns the block. */
  const flush = (ctx: Ctx): Block | null => {
    const text = buf.replace(/\s+$/, '')
    let b: Block | null = null
    if (HAS_TEXT.test(text)) {
      b = { text, kind: ctx.kind }
      if (ctx.kind === 'h' && ctx.level) b.level = ctx.level
      const n = notes.filter(([s]) => s < text.length).map(([s, e]) => [s, Math.min(e, text.length)] as [number, number])
      if (n.length) b.notes = n
      const m: Mark[] = []
      for (const [ms, me, k] of marks) {
        const [s, e] = trimRange(text, ms, me)
        if (e > s) m.push([s, e, k])
      }
      if (m.length) b.marks = m.sort((x, y) => x[0] - y[0] || y[1] - x[1])
      if (ids.length) b.ids = ids
      if (ctx.indent) b.indent = ctx.indent
      if (ctx.quote) b.quote = true
      if (ctx.caption) b.caption = true
      if (ctx.pre) b.pre = 'pre'
      else if (text.includes('\n')) b.pre = 'br'
      if (pendingLi) b.li = pendingLi
      pendingLi = undefined
      blocks.push(b)
      ids = []
    }
    buf = ''
    notes = []
    marks = []
    for (const img of queued) blocks.push(img)
    queued = []
    return b
  }
  const addImage = (href: string | null | undefined, alt: string, el: Element, ctx: Ctx) => {
    if (!href || /^(?:[a-z]+:)?\/\//i.test(href)) return // remote images are not fetched
    const src = href.startsWith('data:') ? href : opts.base !== undefined ? resolvePath(opts.base, href) : decodeURIComponent(href.split('#')[0])
    if (!src.startsWith('data:image/') && !IMAGE_EXT.test(src)) return
    const img: Block = { text: '', kind: 'img', src }
    if (alt) img.alt = alt
    const w = parseInt(el.getAttribute('width') ?? '', 10)
    const h = parseInt(el.getAttribute('height') ?? '', 10)
    if (w > 0 && h > 0 && !/%/.test(`${el.getAttribute('width')}${el.getAttribute('height')}`)) {
      img.w = w
      img.h = h
    }
    if (ctx.indent) img.indent = ctx.indent
    if (HAS_TEXT.test(buf)) {
      queued.push(img)
      return
    }
    flush(ctx)
    if (ids.length) img.ids = ids
    ids = []
    blocks.push(img)
  }
  const svgImages = (svg: Element, ctx: Ctx) => {
    const alt = (byLocalName(svg, 'title')[0]?.textContent ?? svg.getAttribute('aria-label') ?? '').trim()
    for (const im of byLocalName(svg, 'image')) {
      const href = im.getAttribute('href') ?? im.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? im.getAttribute('xlink:href')
      addImage(href, alt, im, ctx)
    }
  }

  const walk = (el: Element, ctx: Ctx) => {
    for (const node of Array.from(el.childNodes)) walkNode(node, ctx)
  }
  const walkNode = (node: Node, ctx: Ctx) => {
    if (node.nodeType === 3 || node.nodeType === 4) {
      append((node as Text).data, ctx)
      return
    }
    if (node.nodeType !== 1) return
    const child = node as Element
    const tag = child.localName.toLowerCase()
    if (tag === 'svg') return svgImages(child, ctx)
    if (SKIP_TAGS.has(tag)) return
    const id = child.getAttribute('id')
    if (id) ids.push(id)
    if (tag === 'img') {
      addImage(child.getAttribute('src'), (child.getAttribute('alt') ?? '').trim(), child, ctx)
    } else if (tag === 'br') {
      if (ctx.pre) append('\n', ctx)
      else lineBreak()
    } else if (ctx.cell) {
      if (BLOCK_TAGS.has(tag) && buf && !/\s$/.test(buf)) append(' ', ctx)
      walkInline(child, tag, ctx)
    } else if (tag === 'tr') {
      flush(ctx)
      const cells = walkRow(child, ctx)
      const b = flush(ctx)
      if (b && cells.length > 1) b.cells = cells.map(([s, e]) => trimRange(b.text, s, e))
    } else if (BLOCK_TAGS.has(tag)) {
      const sub: Ctx = { ...ctx }
      const h = /^h([1-6])$/.exec(tag)
      if (h) {
        sub.kind = 'h'
        sub.level = Math.min(3, Number(h[1])) as 1 | 2 | 3
      }
      if (tag === 'blockquote') {
        sub.quote = true
        sub.indent = ctx.indent + 1
      } else if (tag === 'ul' || tag === 'ol') {
        sub.indent = ctx.indent + 1
      } else if (tag === 'pre') {
        sub.pre = true
      } else if (tag === 'figcaption' || tag === 'caption') {
        sub.caption = true
      }
      flush(ctx)
      if (tag === 'ul' || tag === 'ol') {
        walkList(child, tag, sub)
      } else {
        if (tag === 'li') pendingLi = '•' // stray <li> outside a list
        walk(child, sub)
        flush(sub)
        pendingLi = undefined
      }
    } else {
      walkInline(child, tag, ctx)
    }
  }
  const walkInline = (child: Element, tag: string, ctx: Ctx) => {
    const isNote = !inNote && isNoteRef(child)
    const mark = markOf(child, tag)
    const start = buf.length
    if (isNote) inNote = true
    walk(child, ctx)
    if (isNote) {
      inNote = false
      if (buf.length > start) notes.push([start, buf.length])
    }
    if (mark && buf.length > start) marks.push([start, buf.length, mark])
  }
  const walkList = (list: Element, tag: string, ctx: Ctx) => {
    const bare = /list-style(?:-type)?\s*:\s*none/i.test(list.getAttribute('style') ?? '') || /\bno-?bullets?\b|\bnone\b|\bplain\b/i.test(list.getAttribute('class') ?? '')
    let n = parseInt(list.getAttribute('start') ?? '1', 10)
    if (!Number.isFinite(n)) n = 1
    const type = list.getAttribute('type') ?? ''
    for (const node of Array.from(list.childNodes)) {
      if (node.nodeType !== 1 || (node as Element).localName.toLowerCase() !== 'li') {
        walkNode(node, ctx)
        continue
      }
      const item = node as Element
      const v = parseInt(item.getAttribute('value') ?? '', 10)
      if (Number.isFinite(v)) n = v
      flush(ctx)
      const id = item.getAttribute('id')
      if (id) ids.push(id)
      const itemBare = bare || /list-style(?:-type)?\s*:\s*none/i.test(item.getAttribute('style') ?? '')
      pendingLi = itemBare ? undefined : tag === 'ol' ? `${listLabel(n, type)}.` : ctx.indent > 1 ? '◦' : '•'
      walk(item, ctx)
      flush(ctx)
      pendingLi = undefined
      n++
    }
  }
  /** Table row: cells are joined into one buffer with CELL_SEP; returns the cell ranges. */
  const walkRow = (tr: Element, ctx: Ctx): Array<[number, number]> => {
    const cells: Array<[number, number]> = []
    const cellCtx: Ctx = { ...ctx, cell: true }
    for (const cell of Array.from(tr.children)) {
      const tag = cell.localName.toLowerCase()
      if (tag !== 'td' && tag !== 'th') continue
      const id = cell.getAttribute('id')
      if (id) ids.push(id)
      const before = buf
      if (cells.length) buf = buf.replace(/\s+$/, '') + CELL_SEP
      const start = buf.length
      walk(cell, cellCtx)
      buf = buf.replace(/\s+$/, '')
      if (!HAS_TEXT.test(buf.slice(start))) {
        // empty cell: drop it together with its separator
        buf = before
        marks = marks.filter(([s]) => s < buf.length)
        notes = notes.filter(([s]) => s < buf.length)
        continue
      }
      if (tag === 'th') marks.push([start, buf.length, 'b'])
      cells.push([start, buf.length])
    }
    return cells
  }

  walk(body, ROOT)
  flush(ROOT)
  return blocks
}

/** Intrinsic pixel size from an image header (PNG, GIF, JPEG, WebP, SVG); null if unknown. */
export function imageSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (bytes.length < 24) return null
  const u16 = (i: number) => (bytes[i] << 8) | bytes[i + 1]
  const u32 = (i: number) => ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0
  const le16 = (i: number) => bytes[i] | (bytes[i + 1] << 8)
  const le24 = (i: number) => bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16)
  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { w: u32(16), h: u32(20) }
  // GIF
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return { w: le16(6), h: le16(8) }
  // JPEG: find the first SOFn marker
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++
        continue
      }
      const m = bytes[i + 1]
      if (m === 0xff) {
        i++
        continue
      }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2
        continue
      }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: u16(i + 5), w: u16(i + 7) }
      i += 2 + u16(i + 2)
    }
    return null
  }
  // WebP
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes.length >= 30) {
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
    if (chunk === 'VP8X') return { w: le24(24) + 1, h: le24(27) + 1 }
    if (chunk === 'VP8 ') return { w: le16(26) & 0x3fff, h: le16(28) & 0x3fff }
    if (chunk === 'VP8L') {
      const b = bytes.subarray(21, 25)
      return { w: 1 + (((b[1] & 0x3f) << 8) | b[0]), h: 1 + (((b[3] & 0xf) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6)) }
    }
    return null
  }
  // SVG: width/height attributes, else viewBox
  const head = new TextDecoder().decode(bytes.subarray(0, 4096))
  const svg = /<svg\b[^>]*>/i.exec(head)?.[0]
  if (svg) {
    const num = (name: string) => {
      const m = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(?:px)?\\s*["']`, 'i').exec(svg)
      return m ? parseFloat(m[1]) : NaN
    }
    const w = num('width')
    const h = num('height')
    if (w > 0 && h > 0) return { w: Math.round(w), h: Math.round(h) }
    const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg)
    if (vb) return { w: Math.round(parseFloat(vb[1])), h: Math.round(parseFloat(vb[2])) }
  }
  return null
}
