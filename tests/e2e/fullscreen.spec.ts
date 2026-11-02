import { expect, test } from '@playwright/test'
import { importFile } from './helpers'

test('full screen hides the bars and brings them back', async ({ page }) => {
  await page.goto('/?tts=fake')
  await importFile(page, 'alice.epub')
  const button = page.getByTestId('fullscreen-button')
  await expect(page.getByTestId('toc-button')).toBeVisible()
  await expect(page.getByTestId('where-bar')).toBeVisible()

  await button.click()
  await expect(page.getByTestId('where-bar')).toHaveCount(0)
  await expect(page.getByTestId('toc-button')).toHaveCount(0)
  await expect(page.getByTestId('aa-button')).toHaveCount(0)
  await expect(button).toHaveAttribute('aria-label', 'Exit full screen')
  await expect(page.getByTestId('reader-text')).toBeVisible()

  await button.click()
  await expect(page.getByTestId('where-bar')).toBeVisible()
  await expect(page.getByTestId('toc-button')).toBeVisible()
  await expect(page.getByTestId('aa-button')).toBeVisible()
  await expect(button).toHaveAttribute('aria-label', 'Full screen')
})
