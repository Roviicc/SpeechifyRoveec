import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { BookIndex, FlatBlock } from '@/engine/book/bookIndex'
import { useSettings } from '@/state/settings'
import { ReflowSurface } from '@/features/reader/highlight/surface'
import { BlockView, ImagesContext } from './blockContent'
import { EpubImages } from './epubImages'

const FONTS = { serif: 'var(--font-serif)', sans: 'var(--font-sans)', dyslexic: 'var(--font-dyslexic)' }
const MARGINS = { narrow: 'max-w-[52rem] px-4', normal: 'max-w-[42rem] px-6', wide: 'max-w-[34rem] px-10' }

/**
 * Where a page of the original PDF starts. The label is CSS generated content, so the marker adds no text to the
 * DOM: nothing to read aloud, select, hit with a caret or confuse the `[data-b]` offset mapping and position anchor.
 */
function PageMarker({ page }: { page: number }) {
  return <div className="page-marker" aria-hidden data-testid="page-marker" data-label={`— page ${page + 1} —`} />
}

const Sections = memo(function Sections({ index, titles }: { index: BookIndex; titles: string[] }) {
  const groups: FlatBlock[][] = []
  for (const b of index.blocks) (groups[b.section] ??= []).push(b)
  // PDFs: blocks that start a new page of the original get a "— page N —" marker before them
  const pageStarts = new Set<number>()
  let prevPage: number | undefined
  for (const b of index.blocks) {
    if (b.page !== undefined && b.page !== prevPage) pageStarts.add(b.index)
    if (b.page !== undefined) prevPage = b.page
  }
  return (
    <>
      {groups.map((blocks, si) =>
        blocks ? (
          <section key={si} data-s={si} aria-label={titles[si]}>
            {blocks.map((b) =>
              pageStarts.has(b.index) ? (
                <Fragment key={b.index}>
                  <PageMarker page={b.page!} />
                  <BlockView b={b} />
                </Fragment>
              ) : (
                <BlockView key={b.index} b={b} />
              ),
            )}
          </section>
        ) : null,
      )}
    </>
  )
})

/**
 * Reflowed text view (EPUB, PDF "Text" mode and the voice test page).
 * `imagesFrom`: id of the book whose stored EPUB file provides the images of 'img' blocks.
 */
export function ReflowView({
  index,
  titles,
  onSurface,
  imagesFrom,
}: {
  index: BookIndex
  titles: string[]
  onSurface: (s: ReflowSurface) => void
  imagesFrom?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { fontSize, fontFamily, lineHeight, margin } = useSettings()
  const images = useMemo(() => (imagesFrom ? new EpubImages(imagesFrom) : null), [imagesFrom])
  useEffect(() => () => images?.dispose(), [images])
  useLayoutEffect(() => {
    if (ref.current) onSurface(new ReflowSurface(ref.current))
  }, [index, onSurface])
  return (
    <div
      ref={ref}
      data-testid="reader-text"
      className={`reader-text mx-auto pt-6 pb-48 ${MARGINS[margin]}`}
      style={{ ['--reader-size' as string]: `${fontSize}px`, ['--reader-lh' as string]: lineHeight, ['--reader-font' as string]: FONTS[fontFamily] }}
    >
      <ImagesContext.Provider value={images}>
        <Sections index={index} titles={titles} />
      </ImagesContext.Provider>
    </div>
  )
}
