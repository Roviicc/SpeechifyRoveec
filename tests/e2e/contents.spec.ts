import { expect, test, type Page } from '@playwright/test'
import { importFile, sentenceHighlight, shot } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('/?tts=fake')
})

/** Switch the theme in place (no reload, so the reader stays where it is). */
const theme = (page: Page, t: 'light' | 'dark') => page.evaluate((v) => (document.documentElement.dataset.theme = v), t)

type Lumen = { session(): { player: { index: number }; index: { sentences: Array<{ block: number }>; blocks: Array<{ page?: number }> } } }
const currentPage = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __lumen: Lumen }).__lumen.session()
    return s.index.blocks[s.index.sentences[s.player.index].block].page
  })

/** Move to the middle of the current section (paused). */
const seekHalfway = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __lumen: { session(): { player: { index: number }; index: { sentences: Array<{ section: number }> }; seekTo(i: number): void } } }).__lumen.session()
    const sec = s.index.sentences[s.player.index].section
    const inSec = s.index.sentences.map((x, i) => (x.section === sec ? i : -1)).filter((i) => i >= 0)
    s.seekTo(inSec[Math.floor(inSec.length / 2)])
  })

test('EPUB contents: finished chapters get a check, the current one shows progress', async ({ page }, info) => {
  await importFile(page, 'alice.epub')
  await page.getByTestId('toc-button').click()
  const sheet = page.getByTestId('toc-sheet')
  // nothing read yet: no checks, no Pages tab for an EPUB
  await expect(sheet.getByTestId('toc-done')).toHaveCount(0)
  await expect(sheet.getByTestId('toc-tabs')).toHaveCount(0)
  // chapters not read yet keep their time estimate
  await expect(sheet.getByRole('button', { name: /Chapter III/ })).toContainText(/min/)
  await sheet.getByRole('button', { name: /Chapter III/ }).click()
  await expect.poll(() => sentenceHighlight(page)).toBe('Chapter III. A Caucus-Race and a Long Tale')

  await page.getByTestId('toc-button').click()
  const done = sheet.locator('[data-toc-done]')
  await expect(done.filter({ hasText: /Chapter I\b/ })).toHaveCount(1)
  await expect(done.filter({ hasText: /Chapter II\b/ })).toHaveCount(1)
  await expect(sheet.locator('[data-toc-done]').filter({ hasText: /Chapter III/ })).toHaveCount(0)
  const current = sheet.locator('[aria-current="location"]')
  await expect(current).toHaveCount(1)
  await expect(current).toContainText('Chapter III')
  await expect(current).toContainText('0%')
  await expect(current.getByTestId('toc-progress')).toBeVisible()
  // halfway through chapter III
  await sheet.getByTestId('sheet-close').click()
  await seekHalfway(page)
  await page.getByTestId('toc-button').click()
  await expect(current).toContainText(/[1-9]\d?%/)
  await shot(page, info, 'contents-epub-light')
  await theme(page, 'dark')
  await shot(page, info, 'contents-epub-dark')
})

test('PDF contents: Pages tab draws thumbnails and jumps to a page', async ({ page }, info) => {
  await importFile(page, 'sound.pdf')
  await expect(page.locator('.textLayer span').first()).toBeAttached({ timeout: 15_000 })
  await seekHalfway(page)
  await page.getByTestId('toc-button').click()
  const sheet = page.getByTestId('toc-sheet')
  await expect(sheet.getByTestId('toc-tabs')).toBeVisible()
  await shot(page, info, 'contents-pdf-light')

  await sheet.getByRole('radio', { name: 'Pages' }).click()
  const grid = sheet.getByTestId('page-grid')
  await expect(grid.locator('[data-page]')).toHaveCount(7)
  await expect(grid.locator('[aria-current="page"]')).toHaveAttribute('data-page', '0')
  // thumbnails near view are drawn (non-blank canvas)
  await expect(grid.locator('canvas[data-drawn]').first()).toBeAttached({ timeout: 15_000 })
  const inked = await grid
    .locator('[data-page="0"] canvas')
    .evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
      let dark = 0
      for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++
      return dark
    })
  expect(inked).toBeGreaterThan(50)
  await expect(grid.locator('canvas[data-drawn]')).not.toHaveCount(0)
  await shot(page, info, 'contents-pages-light')
  await theme(page, 'dark')
  await shot(page, info, 'contents-pages-dark')
  await theme(page, 'light')

  await grid.getByRole('button', { name: 'Page 3', exact: true }).click()
  await expect(sheet).toBeHidden()
  await expect.poll(() => currentPage(page)).toBe(2)

  // reopening remembers the tab and outlines page 3
  await page.getByTestId('toc-button').click()
  await expect(grid.locator('[aria-current="page"]')).toHaveAttribute('data-page', '2')
})
