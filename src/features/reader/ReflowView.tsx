import { memo, useLayoutEffect, useRef } from 'react'
import type { BookIndex, FlatBlock } from '../../engine/doc/bookIndex'
import { useSettings } from '../../store/settings'
import { ReflowSurface } from './surface'

const FONTS = { serif: 'var(--font-serif)', sans: 'var(--font-sans)', dyslexic: 'var(--font-dyslexic)' }
const MARGINS = { narrow: 'max-w-[52rem] px-4', normal: 'max-w-[42rem] px-6', wide: 'max-w-[34rem] px-10' }

const Sections = memo(function Sections({ index, titles }: { index: BookIndex; titles: string[] }) {
  const groups: FlatBlock[][] = []
  for (const b of index.blocks) (groups[b.section] ??= []).push(b)
  return (
    <>
      {groups.map((blocks, si) =>
        blocks ? (
          <section key={si} data-s={si} aria-label={titles[si]}>
            {blocks.map((b) =>
              b.kind === 'h' ? (
                <p key={b.index} data-b={b.index} role="heading" aria-level={2} className={`blk-h ${b.skippedAll ? 'blk-skip' : ''}`}>
                  {b.text}
                </p>
              ) : (
                <p key={b.index} data-b={b.index} className={b.skippedAll ? 'blk-skip' : undefined}>
                  {b.text}
                </p>
              ),
            )}
          </section>
        ) : null,
      )}
    </>
  )
})

/** Reflowed text view (EPUB, PDF "Text" mode and the voice test page). */
export function ReflowView({ index, titles, onSurface }: { index: BookIndex; titles: string[]; onSurface: (s: ReflowSurface) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const { fontSize, fontFamily, lineHeight, margin } = useSettings()
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
      <Sections index={index} titles={titles} />
    </div>
  )
}
