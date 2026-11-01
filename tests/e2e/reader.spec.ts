import { expect, test } from '@playwright/test'
import { importFile, playerInfo, sentenceHighlight, shot, spokenText, wordHighlight } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('/?tts=fake')
})

test('voice test page: play, highlight advances, tap-to-jump, speed', async ({ page }, info) => {
  await page.goto('/?tts=fake#/tts')
  await expect(page.getByTestId('reader-text')).toContainText('Dr. Smith arrived')
  await page.getByTestId('play-pause').click()
  await expect.poll(() => sentenceHighlight(page)).toBe('Dr. Smith arrived at 3.14 p.m. on a grey Tuesday.')
  await expect.poll(() => wordHighlight(page)).not.toBe('')
  // fake voice: 60 ms per character -> sentence 1 lasts ~3 s
  await expect.poll(() => playerInfo(page).then((p) => p.index), { timeout: 6000 }).toBe(1)
  await expect.poll(() => sentenceHighlight(page)).toContain('The lab smelled of coffee')
  // tap a word in the second paragraph
  await page.locator('[data-b="1"]').click({ position: { x: 20, y: 8 } })
  await expect.poll(() => sentenceHighlight(page)).toContain('Kokoro is a small text-to-speech model')
  expect((await playerInfo(page)).state).toBe('playing')
  // speed
  await page.getByTestId('speed-button').click()
  await page.getByTestId('speed-preset-2').click()
  await expect(page.getByTestId('speed-value')).toHaveText('2.0×')
  expect((await playerInfo(page)).speed).toBe(2)
  await expect(page.getByTestId('speed-button')).toHaveText('2×')
  await shot(page, info, 'speed-sheet')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('speed-sheet')).toBeHidden()
  // URLs are read as "link", citations skipped
  const spoken = await spokenText(page)
  expect(spoken).toContain('(see link for details)')
  expect(spoken).not.toContain('[12]')
})

test('EPUB: read, TOC jump, auto-scroll pill, themes, text settings', async ({ page }, info) => {
  await importFile(page, 'alice.epub')
  await expect(page.getByTestId('reader-title')).toHaveText('Alice’s Adventures in Wonderland')
  await expect(page.getByTestId('reader-text')).toContainText('Alice was beginning to get very tired')
  await expect.poll(() => sentenceHighlight(page)).toBe('Chapter I. Down the Rabbit-Hole')
  await shot(page, info, 'reader-light')

  await page.getByTestId('play-pause').click()
  await expect.poll(() => playerInfo(page).then((p) => p.index), { timeout: 8000 }).toBeGreaterThanOrEqual(1)

  // tap-to-jump into paragraph 3
  await page.getByText('So she was considering').click({ position: { x: 10, y: 5 } })
  await expect.poll(() => sentenceHighlight(page)).toMatch(/^So she was considering/)

  // TOC (paused, so the highlight stays put)
  await page.getByTestId('play-pause').click()
  await page.getByTestId('toc-button').click()
  await page.getByRole('button', { name: /Chapter III/ }).click()
  await expect.poll(() => sentenceHighlight(page)).toBe('Chapter III. A Caucus-Race and a Long Tale')

  // scroll away -> "Jump to current" -> back
  const scroller = page.getByTestId('reader-scroll')
  await scroller.hover()
  await page.mouse.wheel(0, -4000)
  await expect(page.getByTestId('jump-to-current')).toBeVisible()
  await page.getByTestId('jump-to-current').click()
  await expect(page.getByTestId('jump-to-current')).toBeHidden()
  const inView = () =>
    page.evaluate(() => {
      const h = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get('tts-sentence')
      const r = [...(h ?? [])][0]?.getBoundingClientRect()
      return r ? r.top > 0 && r.bottom < window.innerHeight : false
    })
  await expect.poll(inView).toBe(true)

  // text settings + theme
  await page.getByTestId('aa-button').click()
  await page.getByTestId('font-size').fill('24')
  await page.getByRole('radio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByTestId('reader-text')).toHaveCSS('font-size', '24px')
  await shot(page, info, 'aa-sheet-dark')
  await page.getByTestId('sheet-close').click()
  await shot(page, info, 'reader-dark')
  await page.getByTestId('aa-button').click()
  await page.getByRole('radio', { name: 'Sepia' }).click()
  await page.getByTestId('sheet-close').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sepia')
  expect(await sentenceHighlight(page)).not.toBe('')
  await shot(page, info, 'reader-sepia')
})

test('resume after reload offers to continue', async ({ page }) => {
  await importFile(page, 'alice.epub')
  await page.getByTestId('play-pause').click()
  await expect.poll(() => playerInfo(page).then((p) => p.index), { timeout: 10_000 }).toBeGreaterThanOrEqual(1)
  await page.getByTestId('next-sentence').click()
  await page.getByTestId('next-sentence').click()
  await expect.poll(() => playerInfo(page).then((p) => p.index)).toBeGreaterThanOrEqual(3)
  await page.getByTestId('play-pause').click()
  const idx = (await playerInfo(page)).index
  await page.waitForTimeout(300)
  await page.reload()
  await expect(page.getByTestId('resume-banner')).toBeVisible()
  await expect(page.getByTestId('resume-banner')).toContainText('Down the Rabbit-Hole')
  expect((await playerInfo(page)).index).toBe(idx)
  await page.getByTestId('resume-continue').click()
  await expect.poll(() => playerInfo(page).then((p) => p.state)).toBe('playing')
  await expect(page.getByTestId('resume-banner')).toBeHidden()
})

test('PDF: original + text mode, smart skip, zoom', async ({ page }, info) => {
  await importFile(page, 'sound.pdf')
  await expect(page.locator('.pdf-page').first()).toBeVisible()
  await expect(page.locator('.textLayer span').first()).toBeAttached({ timeout: 15_000 })
  const spoken = await spokenText(page)
  expect(spoken).not.toContain('Journal of Everyday Acoustics')
  expect(spoken).not.toMatch(/\[\d/)
  expect(spoken).not.toContain('Smith, 2020')
  expect(spoken).toContain('available at link for anyone')

  await page.getByTestId('play-pause').click()
  await expect.poll(() => sentenceHighlight(page)).toContain('Section 1: How sound moves')
  await expect.poll(() => playerInfo(page).then((p) => p.index), { timeout: 8000 }).toBeGreaterThanOrEqual(1)
  await expect.poll(() => sentenceHighlight(page)).toContain('Sound travels as a pressure wave')
  await shot(page, info, 'pdf-original')

  await page.getByTestId('zoom-in').click()
  await expect(page.getByTestId('zoom-level')).toHaveText('125%')
  await page.getByTestId('zoom-out').click()
  await page.getByTestId('zoom-out').click()
  await expect(page.getByTestId('zoom-level')).toHaveText('75%')

  await page.getByTestId('pdf-mode').click()
  await expect(page.getByTestId('reader-text')).toBeVisible()
  await expect(page.locator('.blk-skip', { hasText: 'Journal of Everyday Acoustics' }).first()).toBeAttached()
  await expect.poll(() => sentenceHighlight(page)).not.toBe('')
  await shot(page, info, 'pdf-text')

  // turning citations off makes them readable again
  await page.goto('/?tts=fake#/settings')
  await page.getByText('Citations').click()
  await page.goBack()
  await expect.poll(() => spokenText(page)).toMatch(/\[\d+\]/)
})

test('scanned PDF shows a helpful error', async ({ page }) => {
  await page.getByTestId('nav-plus').click()
  await page.getByTestId('file-input').setInputFiles('tests/fixtures/scanned.pdf')
  await expect(page.getByText(/no text layer/)).toBeVisible({ timeout: 15_000 })
})
