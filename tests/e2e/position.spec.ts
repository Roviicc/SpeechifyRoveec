import { expect, test, type Page } from '@playwright/test'
import { importFile } from './helpers'

/** Text under the reading line (25% down the reader), as the reader sees it. */
function lineText(page: Page) {
  return page.evaluate(() => {
    const c = document.querySelector('[data-testid=reader-scroll]')!.getBoundingClientRect()
    const x = c.left + c.width / 2
    const d = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node } | null }
    // like the app: the reading line, or a little lower when it falls between paragraphs
    for (let step = 0; step < 6; step++) {
      const y = c.top + c.height * 0.25 + 4 + step * 12
      const node = d.caretPositionFromPoint?.(x, y)?.offsetNode ?? document.elementFromPoint(x, y)
      const el = (node?.nodeType === 3 ? node.parentElement : (node as Element))?.closest('[data-b], .textLayer span') as HTMLElement | null
      const t = (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (t) return t
    }
    return ''
  })
}

/** Scroll like a person does (a wheel event marks it as the reader's own scroll). */
async function userScroll(page: Page, by: number) {
  await page.getByTestId('reader-scroll').evaluate((el, dy) => {
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true }))
    el.scrollBy(0, dy)
  }, by)
}


/** Block number (paragraph, heading or image) under the reading line. */
function lineBlock(page: Page) {
  return page.evaluate(() => {
    const sc = document.querySelector('[data-testid=reader-scroll]')!
    const c = sc.getBoundingClientRect()
    for (let step = 0; step < 6; step++) {
      // look through anything floating over the book (panels, banners)
      for (const hit of document.elementsFromPoint(c.left + c.width / 2, c.top + c.height * 0.25 + 4 + step * 12)) {
        const el = hit.closest('[data-b]') as HTMLElement | null
        if (el && sc.contains(el)) return Number(el.dataset.b)
      }
    }
    return -1
  })
}

/** Block of the sentence the voice is on. */
function voiceBlock(page: Page) {
  return page.evaluate(() => {
    const s = (window as unknown as { __lumen: { session(): { player: { index: number }; index: { sentences: Array<{ block: number }> } } } }).__lumen.session()
    return s.index.sentences[s.player.index].block
  })
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?tts=fake')
})

test('reading without audio: reopening returns to the page I was on', async ({ page }) => {
  await importFile(page, 'alice.epub')
  await userScroll(page, 2200)
  await page.waitForTimeout(2000) // saved ~1.2 s after scrolling stops
  const before = await lineBlock(page)
  expect(before).toBeGreaterThan(3)
  await page.reload()
  await expect(page.getByTestId('reader-text')).toBeVisible()
  await page.waitForTimeout(800)
  expect(await lineBlock(page)).toBe(before)
  // the voice starts there too (or at the next readable text, if the line is on a picture)
  const vb = await voiceBlock(page)
  expect(vb === before || vb === before + 1).toBe(true)
})

test('changing the font size keeps the same text on the reading line', async ({ page }) => {
  await importFile(page, 'alice.epub')
  await userScroll(page, 1500)
  await page.waitForTimeout(400)
  const before = await lineBlock(page)
  await page.getByTestId('aa-button').click()
  await page.getByTestId('font-size').fill('28')
  await page.waitForTimeout(400)
  expect(await lineBlock(page)).toBe(before)
})

test('PDF: switching Original <-> Text keeps the place', async ({ page }) => {
  await importFile(page, 'sound.pdf')
  await expect(page.locator('.textLayer span').first()).toBeAttached({ timeout: 15_000 })
  await userScroll(page, 1400)
  await page.waitForTimeout(800)
  let original = await lineText(page)
  // the running header and page numbers are skipped text: put body text on the line instead
  for (let i = 0; i < 6 && (/Journal of Everyday|^\d+$/.test(original) || original.length < 10); i++) {
    await userScroll(page, 90)
    await page.waitForTimeout(500)
    original = await lineText(page)
  }
  expect(original.length).toBeGreaterThan(10)
  await page.getByTestId('pdf-mode').click()
  await expect(page.getByTestId('reader-text')).toBeVisible()
  await page.waitForTimeout(600)
  // the paragraph that held the PDF line is near the top, around the reading line (Original's page margins have
  // no Text-mode equivalent, so allow a few lines of slack)
  const where = await page.evaluate((needle) => {
    const sc = document.querySelector('[data-testid=reader-scroll]')!
    const c = sc.getBoundingClientRect()
    // where the phrase itself is (paragraphs can be long); the sample PDF repeats paragraphs on several pages,
    // so take the copy nearest the reading line
    const tops: number[] = []
    for (const e of sc.querySelectorAll<HTMLElement>('[data-b]')) {
      const at = (e.textContent ?? '').indexOf(needle)
      if (at < 0) continue
      const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT)
      let seen = 0
      for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
        if (seen + n.length > at) {
          const r = document.createRange()
          r.setStart(n, at - seen)
          r.setEnd(n, Math.min(n.length, at - seen + 1))
          tops.push((r.getBoundingClientRect().top - c.top) / c.height)
          break
        }
        seen += n.length
      }
    }
    return tops.length ? tops.reduce((a, b) => (Math.abs(b - 0.25) < Math.abs(a - 0.25) ? b : a)) : null
  }, original.split(' ').slice(0, 3).join(' '))
  expect(where).not.toBeNull()
  expect(where!).toBeGreaterThan(-0.3)
  expect(where!).toBeLessThan(0.45)
})

test('scrolled away from the voice: a chip shows the side and the word, and brings it back', async ({ page }) => {
  await importFile(page, 'alice.epub')
  await expect(page.getByTestId('play-from-here')).toHaveCount(0)
  // voice place is at the start: scroll down past it -> chip at the top, chevron up
  await userScroll(page, 2600)
  const chip = page.getByTestId('jump-to-current')
  await expect(chip).toBeVisible()
  await expect(chip).toHaveAttribute('data-side', 'above')
  await expect(page.getByTestId('jump-word')).not.toBeEmpty()
  await chip.click()
  await expect(chip).toBeHidden()
  // and the other way: put the voice further on, scroll back up -> chip at the bottom
  await page.getByTestId('toc-button').click()
  await page.getByRole('button', { name: /Chapter III/ }).click()
  await userScroll(page, -3000)
  await expect(chip).toBeVisible()
  await expect(chip).toHaveAttribute('data-side', 'below')
  await expect(page.getByTestId('jump-word')).toHaveText('Chapter')
})

test('Contents jumps even after scrolling away (pill showing)', async ({ page }) => {
  await importFile(page, 'alice.epub')
  await userScroll(page, 1800)
  await expect(page.getByTestId('jump-to-current')).toBeVisible()
  await page.getByTestId('toc-button').click()
  await page.getByRole('button', { name: /Chapter III/ }).click()
  await expect(page.getByTestId('jump-to-current')).toBeHidden()
  // the chapter heading is on screen, near the reading line
  await expect.poll(async () => {
    const top = await page.getByTestId('reader-scroll').getByText('Chapter III. A Caucus-Race and a Long Tale').first().evaluate((el) => {
      const c = document.querySelector('[data-testid=reader-scroll]')!.getBoundingClientRect()
      return (el.getBoundingClientRect().top - c.top) / c.height
    })
    return top > 0 && top < 0.5
  }).toBe(true)
})
