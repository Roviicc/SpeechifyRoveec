import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Block, Mark } from '@/engine/book/types'
import type { FlatBlock } from '@/engine/book/bookIndex'
import type { EpubImages } from './epubImages'

export const ImagesContext = createContext<EpubImages | null>(null)

/**
 * Inline content of a text block. The concatenated text of everything returned is exactly
 * `text.slice(from, to)` — ReflowSurface relies on it to map offsets across text nodes.
 */
export function renderRuns(text: string, marks: Mark[] | undefined, from = 0, to = text.length, keyPrefix = ''): ReactNode[] {
  if (!marks?.length) return from === 0 && to === text.length ? [text] : [text.slice(from, to)]
  const cuts = new Set([from, to])
  for (const [s, e] of marks) {
    if (s > from && s < to) cuts.add(s)
    if (e > from && e < to) cuts.add(e)
  }
  const points = [...cuts].sort((a, b) => a - b)
  const out: ReactNode[] = []
  for (let i = 0; i + 1 < points.length; i++) {
    const s = points[i]
    const e = points[i + 1]
    const kinds = [...new Set(marks.filter(([ms, me]) => ms <= s && me >= e).map((m) => m[2]))]
    const piece = text.slice(s, e)
    out.push(
      kinds.length ? (
        <span key={`${keyPrefix}${s}`} className={kinds.map((k) => `m-${k}`).join(' ')}>
          {piece}
        </span>
      ) : (
        piece
      ),
    )
  }
  return out
}

/** Table row: cells laid out side by side; the separators stay in the DOM text but are hidden. */
function rowContent(b: Block): ReactNode[] {
  const out: ReactNode[] = []
  let pos = 0
  b.cells!.forEach(([s, e], i) => {
    if (s > pos) out.push(<span key={`g${i}`} className="cell-sep">{b.text.slice(pos, s)}</span>)
    out.push(
      <span key={`c${i}`} className="cell">
        {renderRuns(b.text, b.marks, s, e, `c${i}-`)}
      </span>,
    )
    pos = e
  })
  if (pos < b.text.length) out.push(<span key="tail" className="cell-sep">{b.text.slice(pos)}</span>)
  return out
}

function EpubImage({ b }: { b: FlatBlock }) {
  const images = useContext(ImagesContext)
  const ref = useRef<HTMLSpanElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const src = b.src
  useEffect(() => {
    const el = ref.current
    if (!el || !src || !images) return
    let cancelled = false
    const load = () => {
      void images.url(src).then((u) => {
        if (cancelled) return
        if (u) setUrl(u)
        else setFailed(true)
      })
    }
    if (typeof IntersectionObserver === 'undefined') {
      load()
      return () => {
        cancelled = true
      }
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        load()
      },
      { rootMargin: '1200px 0px' },
    )
    io.observe(el)
    return () => {
      cancelled = true
      io.disconnect()
    }
  }, [images, src])
  const style: CSSProperties = b.w && b.h ? { aspectRatio: `${b.w} / ${b.h}`, width: `min(100%, ${b.w}px, calc(var(--img-max-h) * ${(b.w / b.h).toFixed(4)}))` } : {}
  return (
    <span ref={ref} className={`img-box ${url ? 'img-loaded' : ''} ${failed || (!images && !src?.startsWith('data:')) ? 'img-failed' : ''}`} style={style} data-alt={b.alt || 'Image'}>
      {url && <img src={url} alt={b.alt ?? ''} decoding="async" draggable={false} />}
    </span>
  )
}

function blockClass(b: FlatBlock): string {
  const c: string[] = []
  if (b.kind === 'h') c.push('blk-h', `blk-h${b.level ?? 2}`)
  if (b.quote) c.push('blk-quote')
  if (b.li) c.push('blk-li')
  if (b.pre) c.push(b.pre === 'pre' ? 'blk-pre' : 'blk-lines')
  if (b.cells) c.push('blk-row')
  if (b.caption) c.push('blk-cap')
  if (b.skippedAll) c.push('blk-skip')
  return c.join(' ')
}

/** One block of the reflowed view: `[data-b]` element whose textContent === block.text. */
export function BlockView({ b }: { b: FlatBlock }) {
  const style: CSSProperties | undefined = b.indent ? { marginInlineStart: `${Math.min(b.indent, 4) * 1.4}em` } : undefined
  if (b.kind === 'img') {
    return (
      <figure data-b={b.index} className="blk-img" style={style} role="img" aria-label={b.alt || 'Image'}>
        <EpubImage b={b} />
      </figure>
    )
  }
  const cls = blockClass(b) || undefined
  const content = b.cells ? rowContent(b) : renderRuns(b.text, b.marks)
  if (b.kind === 'h') {
    return (
      <p data-b={b.index} role="heading" aria-level={b.level ?? 2} className={cls} style={style}>
        {content}
      </p>
    )
  }
  return (
    <p data-b={b.index} className={cls} style={style} data-li={b.li}>
      {content}
    </p>
  )
}
