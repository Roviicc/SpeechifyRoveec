import { expect, test } from '@playwright/test'
import { importFile, shot } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('/?tts=fake')
})

test('EPUB: where-am-I line, chapter marks and the scrub bubble', async ({ page }, info) => {
  await importFile(page, 'alice.epub')
  await expect(page.getByTestId('where-bar')).toContainText('Chapter I. Down the Rabbit-Hole')
  await expect(page.getByTestId('where-bar')).toContainText('%')
  // follows what is on screen while reading silently
  await page.getByTestId('toc-button').click()
  await page.getByRole('button', { name: /Chapter III/ }).click()
  await expect(page.getByTestId('where-bar')).toContainText('Chapter III')
  // ...and the page really shows chapter III (a jump right after opening must not be undone)
  await expect.poll(() =>
    page.getByTestId('reader-scroll').getByText('Chapter III. A Caucus-Race and a Long Tale').first().evaluate((el) => {
      const c = document.querySelector('[data-testid=reader-scroll]')!.getBoundingClientRect()
      const t = (el.getBoundingClientRect().top - c.top) / c.height
      return t > 0 && t < 0.5
    }),
  ).toBe(true)
  // three chapters -> two marks on the bar
  await expect(page.getByTestId('chapter-ticks').locator('span')).toHaveCount(2)
  // drag the progress bar: the bubble says where you would land
  const bar = page.getByTestId('progress')
  const box = (await bar.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.05, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 5 })
  await expect(page.getByTestId('scrub-bubble')).toContainText('Chapter')
  await shot(page, info, 'scrub-bubble')
  await page.mouse.up()
  await expect(page.getByTestId('scrub-bubble')).toBeHidden()
})

test('PDF: page number in the where-am-I line', async ({ page }, info) => {
  await importFile(page, 'sound.pdf')
  await expect(page.getByTestId('where-bar')).toContainText(/Page 1 of \d+/)
  await expect(page.locator('.textLayer span').first()).toBeAttached({ timeout: 15_000 })
  await page.getByTestId('reader-scroll').evaluate((el) => {
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: 1600, bubbles: true }))
    el.scrollBy(0, 1600)
  })
  await expect(page.getByTestId('where-bar')).toContainText(/Page [2-9] of \d+/)
  await shot(page, info, 'where-bar-pdf')
})
