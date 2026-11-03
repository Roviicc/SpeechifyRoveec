import { expect, test, type Page } from '@playwright/test'
import { importFile, playerInfo, shot } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('/?tts=fake')
})

type Lumen = {
  session(): {
    backend: { inner: { calls: string[] } }
    player: { index: number; state: string }
    index: { sentences: Array<{ section: number }> }
  }
}

/** Texts the (fake) voice has synthesised so far. */
const synthCalls = (page: Page) => page.evaluate(() => (window as unknown as { __lumen: Lumen }).__lumen.session().backend.inner.calls.length)
const resetCalls = (page: Page) => page.evaluate(() => void ((window as unknown as { __lumen: Lumen }).__lumen.session().backend.inner.calls.length = 0))

test('prepare a chapter from Contents, then play it from the prepared audio', async ({ page }, info) => {
  await importFile(page, 'alice.epub')
  await page.getByTestId('toc-button').click()
  const sheet = page.getByTestId('toc-sheet')
  const summary = sheet.getByTestId('prepare-summary')
  await expect(summary).toContainText('Prepare audio ahead')
  await expect(summary).toContainText(/of audio/)
  await shot(page, info, 'prepare-contents-light')

  const row = sheet.locator('li').filter({ hasText: /Chapter II\b/ })
  await resetCalls(page)
  await row.getByTestId('toc-prepare').click()
  await expect(row.getByTestId('toc-prepared')).toBeVisible({ timeout: 30_000 })
  // only that chapter got the check
  await expect(sheet.getByTestId('toc-prepared')).toHaveCount(1)
  await expect(summary).toContainText('Prepare audio ahead')
  const made = await synthCalls(page)
  expect(made).toBeGreaterThan(5)
  await shot(page, info, 'prepare-contents-done-light')
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'))
  await shot(page, info, 'prepare-contents-done-dark')
  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'))

  // stored compressed (Ogg Opus) where WebCodecs can encode it
  const types = await page.evaluate(async () => {
    const req = indexedDB.open('lumen')
    const db: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)))
    const rows: Array<{ blob: Blob; prepared?: number }> = await new Promise((r) => {
      const q = db.transaction('audio').objectStore('audio').getAll()
      q.onsuccess = () => r(q.result)
    })
    db.close()
    return [...new Set(rows.filter((x) => x.prepared).map((x) => x.blob.type))]
  })
  expect(types).toEqual(['audio/ogg; codecs=opus'])

  // play the chapter: no synthesis at all
  await resetCalls(page)
  await row.getByRole('button', { name: /Chapter II\b/ }).click()
  await expect(sheet).toBeHidden()
  await page.getByTestId('play-pause').click()
  await expect.poll(async () => (await playerInfo(page)).state).toBe('playing')
  const start = (await playerInfo(page)).index
  // let it move on to the next sentences (prefetch reads the cache too)
  await expect.poll(async () => (await playerInfo(page)).index, { timeout: 20_000 }).toBeGreaterThan(start + 1)
  expect(await synthCalls(page)).toBe(0)
  await page.getByTestId('play-pause').click()

  // Settings → Storage lists it and can delete it
  await page.getByTestId('reader-back').click()
  await page.getByTestId('nav-settings').click()
  const prepared = page.getByTestId('prepared-book')
  await expect(prepared).toHaveCount(1)
  await expect(prepared).toContainText(/MB/)
  await prepared.scrollIntoViewIfNeeded()
  await shot(page, info, 'prepare-settings-light')
  await prepared.getByTestId('prepared-delete').click()
  await expect(prepared).toHaveCount(0)
})

test('whole-book preparation shows progress everywhere and can be cancelled', async ({ page }, info) => {
  await importFile(page, 'alice.epub')
  // slow the fake voice down so the run is visible
  await page.evaluate(() => {
    const inner = (window as unknown as { __lumen: { session(): { backend: { inner: { generate(t: string, e: number): Promise<unknown> } } } } }).__lumen.session().backend.inner
    const gen = inner.generate.bind(inner)
    inner.generate = async (t, e) => {
      await new Promise((r) => setTimeout(r, 40))
      return gen(t, e)
    }
  })
  await page.getByTestId('toc-button').click()
  const sheet = page.getByTestId('toc-sheet')
  await sheet.getByTestId('prepare-all').click()
  await expect(sheet.getByTestId('prepare-summary')).toContainText('Preparing audio')
  await expect(sheet.getByTestId('prepare-detail')).toContainText(/Whole book · \d+%/)
  await expect(sheet.getByTestId('toc-preparing').first()).toBeVisible()
  await shot(page, info, 'prepare-running-light')
  await sheet.getByTestId('sheet-close').click()
  await expect(page.getByTestId('prepare-indicator')).toBeVisible()
  await shot(page, info, 'prepare-indicator-light')
  // keeps going in the library
  await page.getByTestId('reader-back').click()
  await expect(page.getByTestId('book-meta')).toContainText(/Preparing \d+%/)
  const before = await synthCalls(page)
  await expect.poll(() => synthCalls(page)).toBeGreaterThan(before)
  // cancel from Contents
  await page.getByTestId('book-open').click()
  await page.getByTestId('toc-button').click()
  await sheet.getByTestId('prepare-cancel').click()
  await expect(sheet.getByTestId('prepare-summary')).toContainText('Prepare audio ahead')
  await expect(page.getByTestId('prepare-indicator')).toHaveCount(0)
})

test('WebCodecs Opus: encodes speech-size audio that <audio> and decodeAudioData both play', async ({ page }) => {
  await page.waitForFunction(() => !!(window as unknown as { __lumen?: unknown }).__lumen)
  const r = await page.evaluate(async () => {
    // loaded from the dev server (the path is a URL, not a module the test itself imports)
    const url = '/src/engine/voice/player/opus.ts'
    const { encodeOpus } = (await import(/* @vite-ignore */ url)) as typeof import('../../src/engine/voice/player/opus')
    const rate = 24000
    const sec = 6
    const pcm = new Float32Array(rate * sec)
    // speech-like test signal: a few harmonics with a slow amplitude wobble and a bit of noise
    for (let i = 0; i < pcm.length; i++) {
      const t = i / rate
      const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * t)
      pcm[i] = env * 0.3 * (Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 360 * t) + 0.25 * Math.sin(2 * Math.PI * 720 * t)) + (Math.random() - 0.5) * 0.02
    }
    const blob: Blob | null = await encodeOpus(pcm, rate)
    if (!blob) return null
    const ctx = new OfflineAudioContext(1, 48000, 48000)
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
    const audio = new Audio(URL.createObjectURL(blob))
    const elementDuration: number = await new Promise((res, rej) => {
      audio.onloadedmetadata = () => res(audio.duration)
      audio.onerror = () => rej(new Error('audio element could not load it'))
    })
    return { bytes: blob.size, sec, decoded: decoded.duration, elementDuration, type: blob.type }
  })
  expect(r).not.toBeNull()
  expect(r!.type).toBe('audio/ogg; codecs=opus')
  expect(Math.abs(r!.decoded - r!.sec)).toBeLessThan(0.05)
  expect(Math.abs(r!.elementDuration - r!.sec)).toBeLessThan(0.05)
  const mbPerMinute = ((r!.bytes / r!.sec) * 60) / 1024 / 1024
  console.log(`Opus: ${r!.bytes} bytes for ${r!.sec} s = ${mbPerMinute.toFixed(3)} MB/min`)
  expect(mbPerMinute).toBeLessThan(0.3)
})
