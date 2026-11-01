import type * as PdfJs from 'pdfjs-dist'

let loaded: Promise<typeof PdfJs> | null = null

/** Lazy-load pdf.js (and its worker) only when a PDF is opened. */
export function getPdfjs(): Promise<typeof PdfJs> {
  loaded ??= (async () => {
    const pdfjs = await import('pdfjs-dist')
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    return pdfjs
  })()
  return loaded
}
