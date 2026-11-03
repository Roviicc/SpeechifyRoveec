import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test'
import { importFile, playerInfo, shot } from './helpers'
import { DriveStub, network, SIGNED_IN } from './driveStub'

/*
 * Prepared audio travels from one device ("PC") to another ("phone") through the (stubbed) Drive appDataFolder.
 * Each device is its own browser context, so they share nothing but the stub.
 */

type Inner = { calls: string[]; info: unknown; voice?: string }
type Lumen = { session(): { backend: { inner: Inner } } }

const synthCalls = (page: Page) => page.evaluate(() => (window as unknown as { __lumen: Lumen }).__lumen.session().backend.inner.calls.length)
const resetCalls = (page: Page) => page.evaluate(() => void ((window as unknown as { __lumen: Lumen }).__lumen.session().backend.inner.calls.length = 0))
/** the live voice was initialised (loaded) */
const voiceLoaded = (page: Page) => page.evaluate(() => (window as unknown as { __lumen: Lumen }).__lumen.session().backend.inner.info !== null)

async function device(browser: Browser, info: TestInfo, stub: DriveStub, net: 'wifi' | 'cellular') {
  const use = info.project.use
  const context = await browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport,
    deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    userAgent: use.userAgent,
  })
  await stub.install(context)
  await context.addInitScript(SIGNED_IN)
  await context.addInitScript(network(net))
  const page = await context.newPage()
  await page.goto('/?tts=fake')
  return { context, page }
}

test('prepare on one device, play it on another through Drive with no synthesis', async ({ browser }, info) => {
  test.setTimeout(120_000)
  const stub = new DriveStub()

  // ---- PC: prepare Chapter II; its pack is uploaded ----
  const pc = await device(browser, info, stub, 'wifi')
  await importFile(pc.page, 'alice.epub')
  await pc.page.getByTestId('toc-button').click()
  let sheet = pc.page.getByTestId('toc-sheet')
  let row = sheet.locator('li').filter({ hasText: /Chapter II\b/ })
  await row.getByTestId('toc-prepare').click()
  await expect(row.getByTestId('toc-prepared')).toBeVisible({ timeout: 30_000 })
  await expect(sheet.getByTestId('drive-detail')).toHaveText('Uploaded to Drive · 1 chapter', { timeout: 20_000 })
  await shot(pc.page, info, 'drive-pc-uploaded-light')
  const packs = stub.packs()
  expect(packs).toHaveLength(1)
  const props = packs[0].appProperties
  expect(props.voice).toBe('kokoro')
  expect(Number(props.entries)).toBeGreaterThan(5)
  expect(Number(props.to) - Number(props.from) + 1).toBe(Number(props.entries))
  expect(packs[0].body.subarray(0, 4).toString()).toBe('LMAP')
  const bookId = props.bookId
  await pc.context.close()

  // ---- phone (cellular, fast voice selected): sees the pack, downloads by hand, plays it without the voice ----
  stub.downloadDelayMs = 1500
  const phone = await device(browser, info, stub, 'cellular')
  await phone.page.evaluate(() => void ((window as unknown as { __lumen: Lumen }).__lumen.session().backend.inner.voice = 'piper'))
  await importFile(phone.page, 'alice.epub')
  // same file, same id on both devices
  expect(await phone.page.evaluate(() => location.hash)).toContain(bookId)
  await phone.page.getByTestId('toc-button').click()
  sheet = phone.page.getByTestId('toc-sheet')
  row = sheet.locator('li').filter({ hasText: /Chapter II\b/ })
  await expect(row.getByTestId('toc-cloud')).toBeVisible({ timeout: 15_000 })
  await expect(sheet.getByTestId('toc-cloud')).toHaveCount(1)
  await expect(sheet.getByTestId('drive-detail')).toHaveText('1 chapter ready in Drive')
  await expect(sheet.getByTestId('drive-download')).toBeVisible()
  expect(stub.downloads).toBe(0)
  await shot(phone.page, info, 'drive-phone-cloud-light')
  await phone.page.evaluate(() => (document.documentElement.dataset.theme = 'dark'))
  await shot(phone.page, info, 'drive-phone-cloud-dark')
  await phone.page.evaluate(() => (document.documentElement.dataset.theme = 'light'))

  await row.getByTestId('toc-cloud').click()
  await expect(row.getByTestId('toc-downloading')).toBeVisible()
  await expect(sheet.getByTestId('drive-detail')).toHaveText('Downloading from Drive 1/1')
  await shot(phone.page, info, 'drive-phone-downloading-light')
  await expect(row.getByTestId('toc-prepared')).toBeVisible({ timeout: 15_000 })
  await expect(sheet.getByTestId('toc-cloud')).toHaveCount(0)
  // nothing to send back: it came from Drive
  await expect(sheet.getByTestId('drive-detail')).toHaveText('Uploaded to Drive · 1 chapter')
  await shot(phone.page, info, 'drive-phone-downloaded-light')

  await resetCalls(phone.page)
  await row.getByRole('button', { name: /Chapter II\b/ }).click()
  await expect(sheet).toBeHidden()
  await phone.page.getByTestId('play-pause').click()
  await expect.poll(async () => (await playerInfo(phone.page)).state).toBe('playing')
  const start = (await playerInfo(phone.page)).index
  await expect.poll(async () => (await playerInfo(phone.page)).index, { timeout: 20_000 }).toBeGreaterThan(start + 2)
  expect(await synthCalls(phone.page)).toBe(0)
  // the live voice was never loaded for prepared sentences
  expect(await voiceLoaded(phone.page)).toBe(false)
  await phone.page.getByTestId('play-pause').click()

  // Settings → Storage: local and Drive sizes, the share toggle, Remove from Drive
  await phone.page.getByTestId('reader-back').click()
  await phone.page.getByTestId('nav-settings').click()
  const item = phone.page.getByTestId('prepared-book')
  await expect(item).toHaveCount(1)
  await expect(item.getByTestId('prepared-drive')).toContainText(/In Drive: .*MB/)
  await expect(phone.page.getByTestId('toggle-share-audio')).toBeChecked()
  await item.scrollIntoViewIfNeeded()
  await shot(phone.page, info, 'drive-settings-storage-light')
  // deleting here keeps the Drive copy
  await item.getByTestId('prepared-delete').click()
  await expect(item.getByTestId('prepared-delete')).toHaveCount(0)
  expect(stub.packs()).toHaveLength(1)
  await expect(item).toContainText('Not on this device')
  await phone.context.close()

  // ---- tablet on Wi‑Fi: downloads by itself when the book is opened ----
  stub.downloadDelayMs = 0
  const tablet = await device(browser, info, stub, 'wifi')
  await importFile(tablet.page, 'alice.epub')
  await expect.poll(() => stub.downloads, { timeout: 15_000 }).toBe(2)
  await tablet.page.getByTestId('toc-button').click()
  sheet = tablet.page.getByTestId('toc-sheet')
  await expect(sheet.locator('li').filter({ hasText: /Chapter II\b/ }).getByTestId('toc-prepared')).toBeVisible({ timeout: 15_000 })
  await sheet.getByTestId('sheet-close').click()
  await tablet.page.getByTestId('reader-back').click()
  await tablet.page.getByTestId('nav-settings').click()
  await tablet.page.getByTestId('drive-remove').click()
  await expect(tablet.page.getByTestId('prepared-drive')).toHaveCount(0)
  expect(stub.packs()).toHaveLength(0)
  await tablet.context.close()
})
