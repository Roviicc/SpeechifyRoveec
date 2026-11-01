import { readFileSync } from 'node:fs'
import { expect, test, type BrowserContext } from '@playwright/test'
import { FIXTURES } from './helpers'

/*
 * The app is cross-origin isolated; Google sign-in + Picker run on the non-isolated /google.html popup and report
 * back over a BroadcastChannel. Google's scripts and the Drive API are stubbed here (real sign-in needs a human).
 */

const GIS_STUB = `
window.google = window.google || {};
window.google.accounts = { oauth2: { initTokenClient(cfg) {
  const client = { callback: cfg.callback, requestAccessToken() {
    // the real GIS opens an accounts.google.com popup and talks to it through window.opener / the window handle;
    // with COOP same-origin on this page the handle would be severed (reads as closed)
    const w = window.open('https://accounts.google.com/o/oauth2/stub', 'gis', 'popup');
    setTimeout(() => {
      window.__gisOpenerOk = !!(w && !w.closed);
      if (w) w.close();
    }, 400);
    setTimeout(() => client.callback({ access_token: 'fake-token', expires_in: 3600 }), 800);
  } };
  return client;
} } };`

const PICKER_STUB = `
window.gapi = { load(name, cb) {
  const Builder = function () { this.cb = null };
  Builder.prototype.addView = function () { return this };
  Builder.prototype.enableFeature = function () { return this };
  Builder.prototype.setOAuthToken = function (t) { window.__pickerToken = t; return this };
  Builder.prototype.setDeveloperKey = function () { return this };
  Builder.prototype.setAppId = function () { return this };
  Builder.prototype.setTitle = function () { return this };
  Builder.prototype.setCallback = function (cb) { this.cb = cb; return this };
  Builder.prototype.build = function () { const cb = this.cb; return { setVisible() {
    setTimeout(() => cb({ action: 'picked', docs: [{ id: 'drive-alice', name: 'alice.epub', mimeType: 'application/epub+zip' }] }), 50);
  } } };
  const View = function () {};
  View.prototype.setMimeTypes = View.prototype.setIncludeFolders = View.prototype.setMode = function () { return this };
  window.google = window.google || {};
  window.google.picker = { DocsView: View, ViewId: { DOCS: 'docs' }, DocsViewMode: { LIST: 'list' }, PickerBuilder: Builder,
    Feature: { MULTISELECT_ENABLED: 1, SUPPORT_DRIVES: 2 }, Action: { PICKED: 'picked', CANCEL: 'cancel' } };
  cb();
} };`

async function stubGoogle(context: BrowserContext) {
  const js = (body: string) => ({ status: 200, contentType: 'text/javascript', body })
  await context.route('https://accounts.google.com/gsi/client', (r) => r.fulfill(js(GIS_STUB)))
  await context.route('https://accounts.google.com/o/oauth2/**', (r) =>
    r.fulfill({ status: 200, contentType: 'text/html', body: '<p>consent</p>' }),
  )
  await context.route('https://apis.google.com/js/api.js', (r) => r.fulfill(js(PICKER_STUB)))
  const epub = readFileSync(`${FIXTURES}/alice.epub`)
  await context.route('https://www.googleapis.com/**', (r) => {
    const url = r.request().url()
    const cors = { 'Access-Control-Allow-Origin': '*' }
    if (r.request().headers()['authorization'] !== 'Bearer fake-token') return r.fulfill({ status: 401, headers: cors, body: '{}' })
    if (url.includes('alt=media') && url.includes('drive-alice')) return r.fulfill({ status: 200, headers: cors, contentType: 'application/epub+zip', body: epub })
    if (r.request().method() === 'POST') return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"id":"sync1"}' })
    return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"files":[]}' })
  })
}

test('app is cross-origin isolated, sign-in page is not', async ({ page, request }) => {
  await page.goto('/?tts=fake&debug=1')
  expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(true)
  await expect(page.getByTestId('debug-isolation')).toContainText('isolated: yes')
  const res = await request.get('/google.html')
  expect(res.headers()['cross-origin-opener-policy']).toBeUndefined()
  expect(res.headers()['cross-origin-embedder-policy']).toBeUndefined()
})

test('connect Google Drive through the sign-in popup', async ({ page, context }) => {
  await stubGoogle(context)
  await page.goto('/?tts=fake#/settings')
  const popupP = context.waitForEvent('page')
  await page.getByRole('button', { name: 'Connect Google Drive' }).click()
  const popup = await popupP
  await popup.waitForLoadState()
  expect(await popup.evaluate(() => self.crossOriginIsolated)).toBe(false)
  await popup.getByTestId('bridge-continue').click()
  await popup.waitForEvent('close')
  await expect(page.getByText('Connected. Progress, bookmarks')).toBeVisible()
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('lumen-gtoken') ?? 'null')?.value)
  expect(token).toBe('fake-token')
})

test('GIS popup keeps window.opener on the sign-in page', async ({ page, context }) => {
  await stubGoogle(context)
  await page.goto('/?tts=fake#/settings')
  const popupP = context.waitForEvent('page')
  await page.getByRole('button', { name: 'Connect Google Drive' }).click()
  const popup = await popupP
  await popup.getByTestId('bridge-continue').click()
  // the stub answers after 800 ms, so the page is still open here
  await expect.poll(() => popup.evaluate(() => (window as unknown as { __gisOpenerOk?: boolean }).__gisOpenerOk)).toBe(true)
  await popup.waitForEvent('close')

  // control: the same popup opened from the isolated app page is severed (why sign-in can't run there)
  const severed = await page.evaluate(async () => {
    const w = window.open('https://accounts.google.com/o/oauth2/stub', 'gis2', 'popup')
    await new Promise((r) => setTimeout(r, 400))
    const closed = !w || w.closed
    w?.close()
    return closed
  })
  expect(severed).toBe(true)
})

test('import from Google Drive via the Picker on the sign-in page', async ({ page, context }) => {
  await stubGoogle(context)
  await page.goto('/?tts=fake')
  // already signed in: the Picker opens without another tap
  await page.evaluate(() => {
    localStorage.setItem('lumen-gtoken', JSON.stringify({ value: 'fake-token', expiresAt: Date.now() + 3600_000 }))
    localStorage.setItem('lumen-drive-connected', '1')
  })
  await page.getByTestId('nav-plus').click()
  const popupP = context.waitForEvent('page')
  await page.getByTestId('import-drive').click()
  const popup = await popupP
  await popup.waitForEvent('close')
  await expect(page.getByTestId('reader')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('reader-title')).not.toHaveText('')
})

test('closing the sign-in window cancels', async ({ page, context }) => {
  await stubGoogle(context)
  await page.goto('/?tts=fake#/settings')
  const popupP = context.waitForEvent('page')
  await page.getByRole('button', { name: 'Connect Google Drive' }).click()
  const popup = await popupP
  await popup.waitForLoadState()
  await popup.close({ runBeforeUnload: true })
  await expect(page.getByText('Sign-in was cancelled')).toBeVisible()
})
