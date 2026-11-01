import type { PDFDocumentProxy } from 'pdfjs-dist'
import { getPdfjs } from './pdfjs'
import { groupLines, linesToBlocks, markRepeatedLines, type PdfLine, type PdfTextItem } from './pdfLayout'
import type { BookDoc, Section, TocEntry } from './types'

export interface ParsedPdf {
  doc: BookDoc
  cover?: Blob
}

async function outlineToc(pdf: PDFDocumentProxy): Promise<TocEntry[]> {
  const outline = await pdf.getOutline().catch(() => null)
  if (!outline) return []
  const out: TocEntry[] = []
  const walk = async (items: typeof outline, level: number) => {
    for (const it of items) {
      try {
        let dest = it.dest
        if (typeof dest === 'string') dest = await pdf.getDestination(dest)
        if (Array.isArray(dest) && dest[0]) {
          const ref = dest[0]
          const pageIndex = typeof ref === 'number' ? ref : await pdf.getPageIndex(ref)
          out.push({ title: it.title.trim() || `Page ${pageIndex + 1}`, section: pageIndex, level })
        }
      } catch {
        /* unresolvable entry */
      }
      if (it.items?.length) await walk(it.items, level + 1)
    }
  }
  await walk(outline, 0)
  return out
}

export async function renderCover(pdf: PDFDocumentProxy, width = 180): Promise<Blob | undefined> {
  try {
    const page = await pdf.getPage(1)
    const vp1 = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: width / vp1.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    await page.render({ canvas, viewport }).promise
    return await new Promise<Blob | undefined>((r) => canvas.toBlob((b) => r(b ?? undefined), 'image/jpeg', 0.8))
  } catch {
    return undefined
  }
}

export async function parsePdf(data: ArrayBuffer, fallbackTitle = 'Untitled', onProgress?: (f: number) => void): Promise<ParsedPdf> {
  const pdfjs = await getPdfjs()
  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) })
  const pdf = await task.promise
  const pages: PdfLine[][] = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    pages.push(groupLines(content.items.filter((i) => 'str' in i) as PdfTextItem[]))
    page.cleanup()
    onProgress?.(p / pdf.numPages)
  }
  const chars = pages.reduce((a, ls) => a + ls.reduce((b, l) => b + l.text.length, 0), 0)
  if (chars < 20 * Math.max(1, Math.min(pdf.numPages, 3))) {
    throw new Error('This PDF has no text layer (scanned images). Only text-based PDFs can be read aloud.')
  }
  markRepeatedLines(pages)
  const allBody = pages.flat().filter((l) => !l.role).map((l) => l.h).sort((a, b) => a - b)
  const bodyHeight = allBody[allBody.length >> 1]
  const sections: Section[] = pages.map((lines, i) => ({ title: `Page ${i + 1}`, blocks: linesToBlocks(lines, i, bodyHeight) }))

  const meta = await pdf.getMetadata().catch(() => null)
  const info = (meta?.info ?? {}) as { Title?: string; Author?: string }
  const title = info.Title?.trim() || fallbackTitle
  let toc = await outlineToc(pdf)
  let pageToc = false
  if (!toc.length) {
    // fall back to detected headings, then plain pages
    sections.forEach((s, si) =>
      s.blocks.forEach((b, bi) => {
        if (b.kind === 'h' && !b.skip) toc.push({ title: b.text.slice(0, 80), section: si, block: bi || undefined, level: 0 })
      }),
    )
    if (toc.length < 2 || toc.length > 300) {
      toc = sections.map((s, i) => ({ title: s.title, section: i, level: 0 }))
      pageToc = true
    }
  }
  // name each page section after the chapter it belongs to
  if (!pageToc) for (const t of toc) if (t.level === 0 && sections[t.section] && !sections[t.section].title.includes('·')) sections[t.section].title = `${t.title} · p. ${t.section + 1}`
  let current = ''
  sections.forEach((s, i) => {
    if (s.title.includes('·')) current = s.title.split(' · ')[0]
    else if (current) s.title = `${current} · p. ${i + 1}`
  })
  const cover = await renderCover(pdf)
  await task.destroy()
  return { doc: { version: 1, type: 'pdf', title, author: info.Author?.trim() || undefined, sections, toc }, cover }
}
