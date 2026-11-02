import { expect, test, type Page } from '@playwright/test'
import { importFile, playerInfo, sentenceHighlight, setTheme, shot, spokenText } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('/?tts=fake')
})

async function openPdf(page: Page) {
  await importFile(page, 'sound.pdf')
  await expect(page.locator('.textLayer span').first()).toBeAttached({ timeout: 15_000 })
}

/** Centre of the first text-layer span on page 1 containing `text`. */
async function spanCenter(page: Page, text: string) {
  const box = await page.locator('[data-page="0"] .textLayer span', { hasText: text }).first().boundingBox()
  expect(box).not.toBeNull()
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
}

async function doubleTap(page: Page, p: { x: number; y: number }, touch: boolean) {
  if (touch) {
    await page.touchscreen.tap(p.x, p.y)
    await page.waitForTimeout(60)
    await page.touchscreen.tap(p.x, p.y)
  } else {
    await page.mouse.dblclick(p.x, p.y)
  }
}

/** Scroll like a person does (a wheel event marks it as the reader's own scroll). */
async function userScroll(page: Page, by: number) {
  await page.getByTestId('reader-scroll').evaluate((el, dy) => {
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true }))
    el.scrollBy(0, dy)
  }, by)
}

/** Distance from the reader's top edge to the top of page `i`. */
function pageTop(page: Page, i: number) {
  return page.evaluate((n) => {
    const sc = document.querySelector('[data-testid=reader-scroll]')!.getBoundingClientRect()
    return document.querySelector(`[data-page="${n}"]`)!.getBoundingClientRect().top - sc.top
  }, i)
}

test('PDF Original: double tap zooms in and back out; a single tap still jumps', async ({ page }, info) => {
  const touch = info.project.name === 'phone'
  await openPdf(page)
  const zoom = page.getByTestId('zoom-level')
  await expect(zoom).toHaveText('100%')

  const p = await spanCenter(page, 'Sound travels')
  await doubleTap(page, p, touch)
  await expect(zoom).not.toHaveText('100%')
  expect(Number((await zoom.textContent())!.replace('%', ''))).toBeGreaterThan(110)
  // the double tap is not a tap-to-jump
  await page.waitForTimeout(400)
  expect((await playerInfo(page)).state).not.toBe('playing')
  await expect(page.locator('.textLayer span').first()).toBeAttached()
  await shot(page, info, 'pdf-double-tap-zoom')

  // double tap again: back to fit-width
  const sc = (await page.getByTestId('reader-scroll').boundingBox())!
  await doubleTap(page, { x: sc.x + sc.width / 2, y: sc.y + sc.height / 2 }, touch)
  await expect(zoom).toHaveText('100%')
  await page.waitForTimeout(400)
  expect((await playerInfo(page)).state).not.toBe('playing')

  // one tap on a word: jumps there and plays (after the double-tap window)
  await expect(page.locator('.textLayer span', { hasText: 'Sound travels' }).first()).toBeAttached()
  const q = await spanCenter(page, 'Sound travels')
  if (touch) await page.touchscreen.tap(q.x, q.y)
  else await page.mouse.click(q.x, q.y)
  await expect.poll(() => playerInfo(page).then((s) => s.state)).toBe('playing')
  await expect.poll(() => sentenceHighlight(page)).toContain('Sound travels')
  await expect(zoom).toHaveText('100%')
})

test('PDF Original: dark pages invert the page images in the dark theme, highlights stay', async ({ page }, info) => {
  await setTheme(page, 'dark')
  await page.reload()
  await openPdf(page)
  const canvas = page.locator('[data-page="0"] canvas')
  await expect(canvas).toBeAttached()
  await expect.poll(() => canvas.evaluate((c) => getComputedStyle(c).filter)).toContain('invert')
  await page.getByTestId('play-pause').click()
  await expect.poll(() => sentenceHighlight(page)).not.toBe('')
  await page.getByTestId('play-pause').click()
  await shot(page, info, 'pdf-dark-pages')

  await page.getByTestId('aa-button').click()
  await expect(page.getByTestId('pdf-page-settings')).toBeVisible()
  await shot(page, info, 'pdf-aa-sheet-dark')
  await page.getByTestId('pdf-page-settings').getByText('Dark pages', { exact: true }).click()
  await expect(page.getByTestId('toggle-dark-pages')).not.toBeChecked()
  await expect.poll(() => canvas.evaluate((c) => getComputedStyle(c).filter)).not.toContain('invert')
})

test('PDF Text mode shows page markers that are not read; EPUB has none', async ({ page }, info) => {
  await openPdf(page)
  await page.getByTestId('pdf-mode').click()
  await expect(page.getByTestId('reader-text')).toBeVisible()
  const markers = page.getByTestId('page-marker')
  expect(await markers.count()).toBeGreaterThanOrEqual(2)
  await expect(markers.first()).toHaveAttribute('data-label', '— page 1 —')
  await expect(markers.nth(1)).toHaveAttribute('data-label', '— page 2 —')
  await expect(markers.first()).toHaveAttribute('aria-hidden', 'true')
  // the label is drawn by CSS: no text in the DOM, nothing to speak, never inside a block
  expect(await markers.first().evaluate((m) => getComputedStyle(m, '::before').content)).toContain('page 1')
  expect(await markers.first().textContent()).toBe('')
  expect(await page.locator('[data-b] [data-testid=page-marker]').count()).toBe(0)
  expect(await spokenText(page)).not.toContain('page 2 —')
  // highlighting still works next to the markers
  await page.getByTestId('play-pause').click()
  await expect.poll(() => sentenceHighlight(page)).not.toBe('')
  await markers.nth(1).scrollIntoViewIfNeeded()
  await shot(page, info, 'pdf-text-page-markers')

  await page.goto('/?tts=fake')
  await importFile(page, 'alice.epub')
  await expect(page.getByTestId('reader-text')).toBeVisible()
  await expect(page.getByTestId('page-marker')).toHaveCount(0)
})

test('PDF Original: snap to pages (off by default) lines a page up after scrolling; auto-scroll still lands', async ({ page }) => {
  await openPdf(page)
  await expect(page.locator('[data-page="1"]')).toBeAttached()
  // off: a scroll stays where it was put
  const off = (await pageTop(page, 1)) - 60
  await userScroll(page, off)
  await page.waitForTimeout(700)
  expect(Math.abs(await pageTop(page, 1))).toBeGreaterThan(40)

  await page.getByTestId('aa-button').click()
  await expect(page.getByTestId('toggle-snap-pages')).not.toBeChecked()
  await page.getByTestId('pdf-page-settings').getByText('Snap to pages', { exact: true }).click()
  await expect(page.getByTestId('toggle-snap-pages')).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('text-sheet')).toBeHidden()

  // on: scrolling to just past page 2's top settles on it
  await userScroll(page, 120)
  await expect.poll(() => pageTop(page, 1).then(Math.abs), { timeout: 3000 }).toBeLessThan(2)

  // the voice still puts its sentence on the reading line (snapping only follows the reader's own scrolls)
  await page.getByTestId('play-pause').click()
  await expect.poll(() => playerInfo(page).then((p) => p.index), { timeout: 8000 }).toBeGreaterThanOrEqual(1)
  if (await page.getByTestId('jump-to-current').isVisible()) await page.getByTestId('jump-to-current').click()
  await page.waitForTimeout(800)
  const rel = await page.evaluate(() => {
    const sc = document.querySelector('[data-testid=reader-scroll]')!.getBoundingClientRect()
    const h = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get('tts-sentence')
    const r = h ? [...h][0]?.getBoundingClientRect() : null
    return r ? (r.top - sc.top) / sc.height : null
  })
  expect(rel).not.toBeNull()
  expect(rel!).toBeGreaterThan(0.05)
  expect(rel!).toBeLessThan(0.6)
})
