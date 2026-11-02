import { expect, test } from '@playwright/test'
import { importFile, sentenceHighlight, spokenText } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('/?tts=fake')
})

test('two-column PDF: Text mode reads the left column before the right one and greys junk', async ({ page }) => {
  await importFile(page, 'columns.pdf')
  await expect(page.locator('.pdf-page').first()).toBeVisible()

  const spoken = await spokenText(page)
  const at = (s: string) => spoken.indexOf(s)
  expect(at('Paragraph one')).toBeGreaterThan(at('Abstract.'))
  expect(at('Paragraph three')).toBeGreaterThan(at('Paragraph two'))
  expect(at('Paragraph four')).toBeGreaterThan(at('Paragraph three'))
  expect(at('Paragraph six')).toBeGreaterThan(at('Paragraph five'))
  expect(spoken).not.toContain('This footnote')
  expect(spoken).not.toContain('Figure 1.')

  // Original mode: the sentence highlight maps back onto the page's text layer
  await expect(page.locator('.textLayer span').first()).toBeAttached({ timeout: 15_000 })
  await page.getByTestId('play-pause').click()
  await expect.poll(() => sentenceHighlight(page)).toContain('Reading Columns Aloud')
  await page.getByTestId('play-pause').click()

  await page.getByTestId('pdf-mode').click()
  const text = page.getByTestId('reader-text')
  await expect(text).toBeVisible()
  await expect(text).toContainText('Paragraph six')
  const order = await text.evaluate((el) => {
    const t = el.textContent ?? ''
    return ['Paragraph one', 'Paragraph two', 'Paragraph three', 'Paragraph four', 'Paragraph five', 'Paragraph six'].map((s) => t.indexOf(s))
  })
  expect(order.every((v) => v >= 0)).toBe(true)
  expect([...order].sort((a, b) => a - b)).toEqual(order)
  // skipped blocks stay visible, greyed
  await expect(page.locator('.blk-skip', { hasText: 'This footnote' })).toBeAttached()
  await expect(page.locator('.blk-skip', { hasText: 'Figure 1.' })).toBeAttached()
})
