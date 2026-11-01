// Real Kokoro benchmark in headless Chromium through the app's own worker path (WASM q8, no GPU).
// Start a server first (e.g. `npm run build && npm run preview`), then:
//   node scripts/bench-browser.mjs [baseUrl] [sentences] [extra query, e.g. threads=2]
// Prints crossOriginIsolated, the TTS info from the worker and the player's average RTF.
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:4173'
const want = Number(process.argv[3] ?? 6)
const extra = process.argv[4] ? `&${process.argv[4]}` : '' // e.g. threads=2

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  args: ['--disable-gpu'],
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.error('pageerror:', e.message))
const t0 = Date.now()
await page.goto(`${base}/?tts=real&debug=1${extra}#/tts`)
const isolated = await page.evaluate(() => self.crossOriginIsolated)
await page.getByTestId('play-pause').click()
await page.waitForFunction(() => window.__lumen.session().backend.info, null, { timeout: 300_000, polling: 500 })
const readyS = (Date.now() - t0) / 1000
const info = await page.evaluate(() => window.__lumen.session().backend.info)
// rtf samples are pushed per generated sentence
await page.waitForFunction(
  (n) => (window.__lumen.session().player.rtfSamples?.length ?? 0) >= n,
  want,
  { timeout: 600_000, polling: 500 },
)
const r = await page.evaluate(() => {
  const p = window.__lumen.session().player
  return { rtf: p.rtf, samples: p.rtfSamples.slice() }
})
console.log(JSON.stringify({ base, crossOriginIsolated: isolated, info, readySeconds: readyS, ...r }, null, 2))
await browser.close()
