import { expect, test, type Page } from '@playwright/test'
import { importFile, shot } from './helpers'

/** Pretend this browser has a WebGPU adapter (headless Chromium usually has none). */
async function fakeGpu(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: { requestAdapter: async () => ({}) } })
  })
}

/** Whether the page's browser really has a WebGPU adapter. */
const hasAdapter = (page: Page) =>
  page.evaluate(async () => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
    return !!(gpu && (await gpu.requestAdapter().catch(() => null)))
  })

const storedSettings = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('lumen-settings') || '{}'))

test('Settings → Storage: GPU usage slider (20–100 %, per device); Turbo hidden without a GPU', async ({ page }, info) => {
  await page.goto('/?tts=fake#/settings')
  const controls = page.getByTestId('preparing-controls')
  await controls.scrollIntoViewIfNeeded()
  await expect(page.getByTestId('prepare-usage-value')).toHaveText('100%')
  const slider = page.getByTestId('prepare-usage')
  await expect(slider).toHaveAttribute('min', '20')
  await expect(slider).toHaveAttribute('max', '100')
  await expect(slider).toHaveAttribute('step', '10')
  await slider.focus()
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('prepare-usage-value')).toHaveText('40%')
  await slider.focus()
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft')
  // never below 20 %
  await expect(page.getByTestId('prepare-usage-value')).toHaveText('20%')
  const st = await storedSettings(page)
  expect(st.state.prepareUsage).toBe(20)
  expect(st.version).toBe(2)
  // Turbo is offered only where the Natural voice runs on the GPU
  await expect(page.getByTestId('prepare-turbo')).toHaveCount((await hasAdapter(page)) ? 1 : 0)
  await shot(page, info, 'settings-preparing-nogpu-light')
})

test('the old preparing speed is migrated (Balanced → 70 %)', async ({ page }) => {
  await page.goto('/?tts=fake')
  await page.evaluate(() => localStorage.setItem('lumen-settings', JSON.stringify({ state: { prepareSpeed: 'balanced', theme: 'light' }, version: 1 })))
  await page.goto('/?tts=fake#/settings')
  await page.reload()
  await expect(page.getByTestId('prepare-usage-value')).toHaveText('70%')
  const st = await storedSettings(page)
  expect(st.state.prepareSpeed).toBeUndefined()
  expect(st.state.prepareUsage).toBe(70)
})

test('with a GPU: Turbo ×2 runs two workers; live speed and time left are shown while preparing', async ({ page }, info) => {
  await fakeGpu(page)
  await page.goto('/?tts=fake')
  await importFile(page, 'alice.epub')
  // slow the main voice down so the run stays visible
  await page.evaluate(() => {
    const inner = (window as unknown as { __lumen: { session(): { backend: { inner: { generate(t: string, e: number): Promise<unknown> } } } } }).__lumen.session().backend.inner
    const gen = inner.generate.bind(inner)
    inner.generate = async (t, e) => {
      await new Promise((r) => setTimeout(r, 60))
      return gen(t, e)
    }
  })
  await page.getByTestId('reader-back').click()
  await page.getByTestId('nav-settings').click()
  const turbo = page.getByTestId('prepare-turbo')
  await turbo.scrollIntoViewIfNeeded()
  await expect(turbo.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true')
  await turbo.getByRole('radio', { name: '×2' }).click()
  expect((await storedSettings(page)).state.prepareWorkers).toBe(2)
  // slow it further with a low duty cycle, so the run lasts
  const slider = page.getByTestId('prepare-usage')
  await slider.focus()
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('prepare-usage-value')).toHaveText('20%')

  await page.getByTestId('nav-library').click()
  await page.getByTestId('book-open').click()
  await page.getByTestId('toc-button').click()
  await page.getByTestId('toc-sheet').getByTestId('prepare-all').click()
  await page.getByTestId('toc-sheet').getByTestId('sheet-close').click()
  await page.getByTestId('reader-back').click()
  await page.getByTestId('nav-settings').click()
  const stats = page.getByTestId('prepare-stats')
  await stats.scrollIntoViewIfNeeded()
  await expect(stats).toContainText(/×[\d.]+ real time · [\d.]+ sentences\/min/, { timeout: 15_000 })
  await expect(stats).toContainText('2 workers', { timeout: 15_000 })
  await expect(stats).toContainText(/left/)
  const lanes = await page.evaluate(() => (window as unknown as { __lumen: { session(): { lanes: { running: number } } } }).__lumen.session().lanes.running)
  expect(lanes).toBe(1)
  await page.getByTestId('preparing-controls').scrollIntoViewIfNeeded()
  await shot(page, info, 'settings-preparing-turbo-light')
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'))
  await shot(page, info, 'settings-preparing-turbo-dark')

  // Turbo off: the extra worker is disposed right away
  await turbo.getByRole('radio', { name: 'Off' }).click()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __lumen: { session(): { lanes: { running: number } } } }).__lumen.session().lanes.running))
    .toBe(0)
  await page.evaluate(() => (window as unknown as { __lumen: { session(): { preparer: { cancel(): void } } } }).__lumen.session().preparer.cancel())
  await expect(stats).toHaveCount(0)
})

test('Settings → Voice: no Auto / Processor engine choice for the Natural voice', async ({ page }, info) => {
  await page.goto('/?tts=fake#/settings')
  const list = page.getByTestId('voice-list')
  await expect(list).toBeVisible()
  // the Auto / Natural / Fast voice choice is unchanged
  await expect(page.getByTestId('voice-row-auto')).toBeVisible()
  await expect(page.getByText('Natural voice: run on GPU or processor')).toHaveCount(0)
  await expect(page.getByRole('radiogroup', { name: 'Voice engine' })).toHaveCount(0)
  await expect(page.getByRole('radio', { name: 'Processor' })).toHaveCount(0)
  const gpu = await hasAdapter(page)
  await expect(page.getByTestId('voice-gpu-note')).toHaveCount(gpu ? 0 : 1)
  if (!gpu) await expect(page.getByTestId('voice-gpu-note')).toHaveText('This device has no usable GPU — using the processor')
  await list.scrollIntoViewIfNeeded()
  await shot(page, info, 'settings-voice-light')
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'))
  await shot(page, info, 'settings-voice-dark')
})

test('Settings → Voice with a GPU: no processor note', async ({ page }) => {
  await fakeGpu(page)
  await page.goto('/?tts=fake#/settings')
  await expect(page.getByTestId('voice-list')).toBeVisible()
  await expect(page.getByTestId('voice-row-kokoro')).toBeVisible()
  await page.waitForTimeout(200)
  await expect(page.getByTestId('voice-gpu-note')).toHaveCount(0)
})
