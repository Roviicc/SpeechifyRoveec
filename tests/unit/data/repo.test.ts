import { describe, expect, it } from 'vitest'
import { db } from '@/data/db'
import { getContent, getStaleContent, remapPositions } from '@/data/repo'
import { DOC_VERSION, PDF_DOC_VERSION, type BookDoc } from '@/engine/book/types'

const doc = (type: BookDoc['type'], pages: string[][]): BookDoc => ({
  version: 1,
  type,
  title: 't',
  toc: [],
  sections: pages.map((blocks, i) => ({ title: `Page ${i + 1}`, blocks: blocks.map((text) => ({ text, kind: 'p' as const })) })),
})

describe('re-parsing stored PDFs', () => {
  it('treats PDFs parsed by an older parser as stale, but not EPUBs', async () => {
    await db.content.put({ bookId: 'pdf1', version: 2, doc: doc('pdf', [['a']]) })
    await db.content.put({ bookId: 'epub1', version: DOC_VERSION, doc: doc('epub', [['a']]) })
    expect(PDF_DOC_VERSION).toBeGreaterThan(2)
    expect(await getContent('pdf1')).toBeNull()
    expect((await getStaleContent('pdf1'))?.sections[0].blocks[0].text).toBe('a')
    expect(await getContent('epub1')).not.toBeNull()
  })

  it('moves progress, bookmarks and highlights onto the new block numbering', async () => {
    const oldDoc = doc('pdf', [['Title page'], ['Left one right one', 'Left two right two']])
    const newDoc = doc('pdf', [['Title page'], ['Left one', 'Left two', 'right one', 'right two']])
    await db.progress.put({ bookId: 'b', sentence: 3, locator: { section: 1, block: 2, offset: 9 }, percent: 0.5, sectionTitle: 'Page 2', updatedAt: 100 })
    await db.bookmarks.put({ id: 'bm', bookId: 'b', locator: { section: 1, block: 1, offset: 9 }, label: 'x', createdAt: 1, updatedAt: 50 })
    await db.highlights.put({ id: 'h', bookId: 'b', start: { section: 1, block: 2, offset: 0 }, end: { section: 1, block: 2, offset: 8 }, text: 'Left two', color: 'yellow', note: '', createdAt: 1, updatedAt: 60 })
    await remapPositions('b', oldDoc, newDoc)
    const p = await db.progress.get('b')
    expect(p?.locator).toEqual({ section: 1, block: 4, offset: 0 })
    expect(p?.updatedAt).toBe(101)
    expect((await db.bookmarks.get('bm'))?.locator).toEqual({ section: 1, block: 3, offset: 0 })
    const h = await db.highlights.get('h')
    expect([h?.start, h?.end]).toEqual([
      { section: 1, block: 2, offset: 0 },
      { section: 1, block: 2, offset: 8 },
    ])
  })
})
