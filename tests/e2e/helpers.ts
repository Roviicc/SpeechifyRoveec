import { expect, type Page, type TestInfo } from '@playwright/test'

export const FIXTURES = 'tests/fixtures'

export async function importFile(page: Page, file: string) {
  await page.getByTestId('nav-plus').click()
  await expect(page.getByTestId('import-sheet')).toBeVisible()
  await page.getByTestId('file-input').setInputFiles(`${FIXTURES}/${file}`)
  await expect(page.getByTestId('reader')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('reader-title')).not.toHaveText('')
}

/** Text of the current sentence highlight (CSS Custom Highlight API). */
export function sentenceHighlight(page: Page) {
  return page.evaluate(() => {
    const h = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get('tts-sentence')
    return h ? [...h].map((r) => r.toString()).join('') : ''
  })
}

export function wordHighlight(page: Page) {
  return page.evaluate(() => {
    const h = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get('tts-word')
    return h ? [...h].map((r) => r.toString()).join('') : ''
  })
}

type Lumen = { session(): { player: { index: number; speed: number; state: string }; index: { sentences: Array<{ spoken: { text: string } }> } | null } }

export function playerInfo(page: Page) {
  return page.evaluate(() => {
    const s = (window as unknown as { __lumen: Lumen }).__lumen.session()
    return { index: s.player.index, speed: s.player.speed, state: s.player.state }
  })
}

export function spokenText(page: Page) {
  return page.evaluate(() => {
    const s = (window as unknown as { __lumen: Lumen }).__lumen.session()
    return s.index?.sentences.map((x) => x.spoken.text).join(' ') ?? ''
  })
}

export async function shot(page: Page, info: TestInfo, name: string) {
  await page.waitForTimeout(250)
  await page.screenshot({ path: `screenshots/${info.project.name}-${name}.png` })
}

export async function setTheme(page: Page, theme: 'light' | 'dark' | 'sepia') {
  await page.evaluate((t) => {
    const raw = JSON.parse(localStorage.getItem('lumen-settings') || '{"state":{},"version":1}')
    raw.state.theme = t
    localStorage.setItem('lumen-settings', JSON.stringify(raw))
  }, theme)
}

/** Real touch long-press + drag (Chrome DevTools protocol), as a finger would do on a phone. */
export async function longPressDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] })
  await page.waitForTimeout(650)
  for (let i = 1; i <= 6; i++) {
    const x = from.x + ((to.x - from.x) * i) / 6
    const y = from.y + ((to.y - from.y) * i) / 6
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}
