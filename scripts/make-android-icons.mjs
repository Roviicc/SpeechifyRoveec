// Renders public/favicon.svg as Android launcher icons (android/app/src/main/res/mipmap-*). Run: node scripts/make-android-icons.mjs
import { chromium } from 'playwright'
import { readFile, mkdir } from 'node:fs/promises'

const svg = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8')
const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }
const browser = await chromium.launch()
const page = await browser.newPage()
for (const [density, size] of Object.entries(sizes)) {
  const dir = new URL(`../android/app/src/main/res/mipmap-${density}/`, import.meta.url)
  await mkdir(dir, { recursive: true })
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`)
  await page.screenshot({ path: new URL('ic_launcher.png', dir).pathname, omitBackground: true })
}
await browser.close()
console.log('android icons written')
