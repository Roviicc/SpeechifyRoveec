import { expect, test } from '@playwright/test'
import { importFile, shot } from './helpers'

test('full screen hides the bars, keeps play / pause, and brings the bars back', async ({ page }, info) => {
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

  // play / pause stays within reach without the player bar
  const play = page.getByTestId('fullscreen-play-pause')
  await expect(page.getByTestId('play-pause')).toHaveCount(0)
  await play.click()
  await expect(play).toHaveAttribute('aria-label', 'Pause')
  await play.click()
  await expect(play).toHaveAttribute('aria-label', 'Play')
  await shot(page, info, 'fullscreen-play')

  await button.click()
  await expect(play).toHaveCount(0)
  await expect(page.getByTestId('where-bar')).toBeVisible()
  await expect(page.getByTestId('toc-button')).toBeVisible()
  await expect(page.getByTestId('aa-button')).toBeVisible()
  await expect(button).toHaveAttribute('aria-label', 'Full screen')
})
