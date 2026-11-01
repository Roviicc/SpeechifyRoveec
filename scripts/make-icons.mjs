// Renders public/favicon.svg into the PNG icons the PWA manifest needs. Run: npm run icons
import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'

const svg = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8')
const browser = await chromium.launch()
const page = await browser.newPage()
const render = async (size, file, { pad = 0, bg = 'transparent' } = {}) => {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<body style="margin:0;background:${bg};display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${size - pad * 2}px;height:${size - pad * 2}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body>`)
  await page.screenshot({ path: new URL(`../public/${file}`, import.meta.url).pathname, omitBackground: bg === 'transparent' })
}
await render(192, 'pwa-192.png')
await render(512, 'pwa-512.png')
await render(180, 'apple-touch-icon.png', { bg: '#2F54EB' })
// maskable: full-bleed background, logo inside the safe zone
await page.setViewportSize({ width: 512, height: 512 })
await page.setContent(`<body style="margin:0;background:#2F54EB;display:grid;place-items:center;width:512px;height:512px"><div style="width:360px;height:360px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body>`)
await page.screenshot({ path: new URL('../public/pwa-maskable-512.png', import.meta.url).pathname })
await browser.close()
console.log('icons written to public/')
