import JSZip from 'jszip'
import type { BookDoc, Section, TocEntry } from '@/engine/book/types'
import { byLocalName, extractBlocks, imageSize, resolvePath } from './blocks'

export { extractBlocks, imageSize, resolvePath } from './blocks'

interface ManifestItem {
  id: string
  href: string
  path: string
  mediaType: string
  properties: string
}

function parseXml(text: string, type: DOMParserSupportedType = 'application/xhtml+xml'): Document {
  const parser = new DOMParser()
  let doc = parser.parseFromString(text, type)
  if (doc.getElementsByTagName('parsererror').length) doc = parser.parseFromString(text, 'text/html')
  return doc
}

export interface ParsedEpub {
  doc: BookDoc
  cover?: Blob
}

export async function parseEpub(data: ArrayBuffer | Uint8Array, fallbackTitle = 'Untitled'): Promise<ParsedEpub> {
  const zip = await JSZip.loadAsync(data)
  const read = async (path: string) => {
    const f = zip.file(path) ?? zip.file(decodeURIComponent(path))
    if (!f) throw new Error(`Missing file in EPUB: ${path}`)
    return f.async('string')
  }
  const container = parseXml(await read('META-INF/container.xml'), 'application/xml')
  const opfPath = byLocalName(container, 'rootfile')[0]?.getAttribute('full-path')
  if (!opfPath) throw new Error('Not a valid EPUB (no package document)')
  const opf = parseXml(await read(opfPath), 'application/xml')

  const meta = (name: string) => byLocalName(opf, name)[0]?.textContent?.trim() || undefined
  const title = meta('title') ?? fallbackTitle
  const author = meta('creator')

  const manifest = new Map<string, ManifestItem>()
  for (const it of byLocalName(opf, 'item')) {
    const id = it.getAttribute('id') ?? ''
    const href = it.getAttribute('href') ?? ''
    manifest.set(id, {
      id,
      href,
      path: resolvePath(opfPath, href),
      mediaType: it.getAttribute('media-type') ?? '',
      properties: it.getAttribute('properties') ?? '',
    })
  }
  const spineEl = byLocalName(opf, 'spine')[0]
  const spine = byLocalName(opf, 'itemref')
    .map((r) => manifest.get(r.getAttribute('idref') ?? ''))
    .filter((m): m is ManifestItem => !!m && /html|xml/.test(m.mediaType))

  // ----- table of contents -----
  const rawToc: Array<{ title: string; path: string; frag?: string; level: number }> = []
  const navItem = [...manifest.values()].find((m) => m.properties.split(/\s+/).includes('nav'))
  if (navItem) {
    try {
      const nav = parseXml(await read(navItem.path))
      const navs = byLocalName(nav, 'nav')
      const tocNav =
        navs.find((n) => /toc/.test(`${n.getAttribute('epub:type') ?? ''} ${n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ?? ''}`)) ?? navs[0]
      const walkOl = (ol: Element, level: number) => {
        for (const li of Array.from(ol.children).filter((c) => c.localName === 'li')) {
          const a = Array.from(li.children).find((c) => c.localName === 'a' || c.localName === 'span')
          const href = a?.getAttribute('href')
          const text = a?.textContent?.replace(/\s+/g, ' ').trim()
          if (a && href && text) rawToc.push({ title: text, path: resolvePath(navItem.path, href), frag: href.split('#')[1], level })
          const sub = Array.from(li.children).find((c) => c.localName === 'ol')
          if (sub) walkOl(sub, level + 1)
        }
      }
      const ol = tocNav && byLocalName(tocNav, 'ol')[0]
      if (ol) walkOl(ol, 0)
    } catch {
      /* fall back to NCX */
    }
  }
  if (!rawToc.length) {
    const ncxItem = manifest.get(spineEl?.getAttribute('toc') ?? '') ?? [...manifest.values()].find((m) => m.mediaType === 'application/x-dtbncx+xml')
    if (ncxItem) {
      try {
        const ncx = parseXml(await read(ncxItem.path), 'application/xml')
        const walkPoints = (parent: Element, level: number) => {
          for (const np of Array.from(parent.children).filter((c) => c.localName === 'navPoint')) {
            const label = byLocalName(np, 'text')[0]?.textContent?.replace(/\s+/g, ' ').trim()
            const src = byLocalName(np, 'content')[0]?.getAttribute('src')
            if (label && src) rawToc.push({ title: label, path: resolvePath(ncxItem.path, src), frag: src.split('#')[1], level })
            walkPoints(np, level + 1)
          }
        }
        const navMap = byLocalName(ncx, 'navMap')[0]
        if (navMap) walkPoints(navMap, 0)
      } catch {
        /* no toc */
      }
    }
  }

  // ----- sections -----
  const sections: Section[] = []
  const sectionByPath = new Map<string, number>()
  for (const item of spine) {
    let text: string
    try {
      text = await read(item.path)
    } catch {
      continue
    }
    const xhtml = parseXml(text)
    const body = byLocalName(xhtml, 'body')[0] ?? xhtml.documentElement
    const blocks = extractBlocks(body, { base: item.path })
    if (!blocks.length) continue
    // intrinsic image sizes, so the layout doesn't shift when images load
    for (const b of blocks) {
      if (b.kind !== 'img' || !b.src || b.src.startsWith('data:') || (b.w && b.h)) continue
      const f = zip.file(b.src)
      const size = f ? imageSize(await f.async('uint8array')) : null
      if (size && size.w > 0 && size.h > 0) {
        b.w = size.w
        b.h = size.h
      }
    }
    sectionByPath.set(item.path, sections.length)
    sections.push({ title: '', blocks })
  }
  const toc: TocEntry[] = []
  for (const t of rawToc) {
    const section = sectionByPath.get(t.path)
    if (section === undefined) continue
    let block: number | undefined
    if (t.frag) {
      const bi = sections[section].blocks.findIndex((b) => b.ids?.includes(t.frag!))
      if (bi > 0) block = bi
    }
    toc.push({ title: t.title, section, block, level: t.level })
    if (!sections[section].title && !block) sections[section].title = t.title
  }
  sections.forEach((s, i) => {
    if (!s.title) {
      const prev = [...toc].reverse().find((t) => t.section < i)
      const heading = s.blocks.find((b) => b.kind === 'h')?.text
      s.title = heading?.slice(0, 80) ?? prev?.title ?? `Section ${i + 1}`
    }
  })
  if (!toc.length) sections.forEach((s, i) => toc.push({ title: s.title, section: i, level: 0 }))

  // ----- cover -----
  let cover: Blob | undefined
  const coverMetaId = byLocalName(opf, 'meta').find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content')
  const coverItem =
    [...manifest.values()].find((m) => m.properties.split(/\s+/).includes('cover-image')) ??
    (coverMetaId ? manifest.get(coverMetaId) : undefined)
  if (coverItem && coverItem.mediaType.startsWith('image/')) {
    const f = zip.file(coverItem.path)
    if (f) cover = new Blob([await f.async('arraybuffer')], { type: coverItem.mediaType })
  }

  return { doc: { version: 1, type: 'epub', title, author, sections, toc }, cover }
}
