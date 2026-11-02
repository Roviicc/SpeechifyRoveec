import { expect, test } from '@playwright/test'
import { importFile, longPressDrag, playerInfo, sentenceHighlight, setTheme, shot } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('/?tts=fake')
})

test('library rows, mini player, rename, delete, search', async ({ page }, info) => {
  await expect(page.getByTestId('library-empty')).toBeVisible()
  await shot(page, info, 'library-empty')
  await importFile(page, 'alice.epub')
  await page.getByTestId('play-pause').click()
  await expect.poll(() => playerInfo(page).then((p) => p.state)).toBe('playing')
  await page.getByTestId('reader-back').click()
  await expect(page.getByTestId('mini-player')).toBeVisible()
  await page.getByTestId('mini-play').click()
  await expect.poll(() => playerInfo(page).then((p) => p.state)).toBe('paused')

  await importFile(page, 'sound.pdf')
  await page.getByTestId('reader-back').click()
  await expect(page.getByTestId('book-row')).toHaveCount(2)
  await expect(page.getByTestId('book-meta').first()).toHaveText(/^\d+% • Today • (pdf|epub)$/)
  await page.getByTestId('nav-plus').click()
  await shot(page, info, 'import-sheet')
  await page.getByTestId('sheet-close').click()
  await shot(page, info, 'library-light')
  await setTheme(page, 'dark')
  await page.reload()
  await shot(page, info, 'library-dark')

  // rename
  const row = page.getByTestId('book-row').filter({ hasText: 'Alice' })
  await row.getByTestId('book-menu').click()
  await page.getByTestId('book-rename').click()
  await page.getByTestId('rename-input').fill('Alice (renamed)')
  await page.getByTestId('rename-save').click()
  await expect(page.getByTestId('book-title').filter({ hasText: 'Alice (renamed)' })).toBeVisible()

  // search
  await page.getByTestId('library-search-button').click()
  await page.getByTestId('library-search').fill('renamed')
  await expect(page.getByTestId('book-row')).toHaveCount(1)
  await page.getByRole('button', { name: 'Close search' }).click()

  // delete
  await page.getByTestId('book-row').filter({ hasText: 'Alice' }).getByTestId('book-menu').click()
  await page.getByTestId('book-delete').click()
  await page.getByTestId('delete-confirm').click()
  await expect(page.getByTestId('book-row')).toHaveCount(1)
})

test('bookmarks, highlights with notes, search in book', async ({ page }, info) => {
  await importFile(page, 'alice.epub')
  await page.getByTestId('bookmark-button').click()
  await expect(page.getByTestId('bookmark-button')).toHaveAttribute('aria-pressed', 'true')

  // select some text -> highlight toolbar
  const pts = await page.evaluate(() => {
    const p = [...document.querySelectorAll('[data-b]')].find((e) => e.textContent?.startsWith('There was nothing so very remarkable'))! as HTMLElement
    p.scrollIntoView({ block: 'center' })
    const node = p.firstChild!
    const at = (i: number) => {
      const r = document.createRange()
      r.setStart(node, i)
      r.setEnd(node, i + 1)
      const b = r.getBoundingClientRect()
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
    }
    return { from: at(1), to: at(30) }
  })
  if (info.project.name === 'phone') {
    // phones: Lumen's own long-press selection (no Android menu / Touch to Search)
    await longPressDrag(page, pts.from, pts.to)
    expect(await page.evaluate(() => window.getSelection()?.isCollapsed ?? true)).toBe(true)
  } else {
    await page.evaluate(() => {
      const p = [...document.querySelectorAll('[data-b]')].find((e) => e.textContent?.startsWith('There was nothing so very remarkable'))! as HTMLElement
      const r = document.createRange()
      r.setStart(p.firstChild!, 0)
      r.setEnd(p.firstChild!, 35)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(r)
    })
  }
  await expect(page.getByTestId('selection-toolbar')).toBeVisible()
  await expect(page.getByTestId('lookup')).toBeVisible()
  await shot(page, info, 'selection-toolbar')
  await page.getByRole('button', { name: 'Highlight with note' }).click()
  await page.getByTestId('note-input').fill('The rabbit!')
  await page.getByTestId('note-save').click()

  await page.getByTestId('more-button').click()
  await page.getByTestId('menu-notes').click()
  await expect(page.getByTestId('bookmark-item')).toHaveCount(1)
  await page.getByRole('radio', { name: /Highlights/ }).click()
  await expect(page.getByTestId('highlight-item')).toHaveCount(1)
  await expect(page.getByTestId('highlight-item')).toContainText('The rabbit!')
  await shot(page, info, 'notes-sheet')
  await page.getByTestId('highlight-item').getByRole('button').first().click()
  await expect(page.getByTestId('notes-sheet')).toBeHidden()
  await expect.poll(() => sentenceHighlight(page)).toMatch(/^There was nothing so very remarkable/)

  // search
  await page.getByTestId('more-button').click()
  await page.getByTestId('menu-search').click()
  await page.getByTestId('search-input').fill('marmalade')
  await expect(page.getByTestId('search-result')).toHaveCount(1)
  await shot(page, info, 'search-sheet')
  await page.getByTestId('search-result').click()
  await expect.poll(() => sentenceHighlight(page)).toContain('Orange Marmalade')

  // reload: notes persist
  await page.reload()
  await page.getByTestId('more-button').click()
  await page.getByTestId('menu-notes').click()
  await expect(page.getByTestId('bookmark-item')).toHaveCount(1)
})

test('settings: pronunciation dictionary and sleep timer', async ({ page }, info) => {
  await page.getByTestId('nav-settings').click()
  await page.getByTestId('dict-word').fill('Alice')
  await page.getByTestId('dict-say').fill('Al-eese')
  await page.getByTestId('dict-add').click()
  // voice list: Auto selected by default, both voices offered with their size
  await expect(page.getByTestId('voice-row-auto').getByRole('radio')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('voice-row-kokoro')).toContainText('MB')
  await expect(page.getByTestId('voice-row-piper')).toContainText('MB')
  // look-up app setting
  await page.getByRole('radio', { name: 'ColorDict' }).click()
  await expect(page.getByText('Opens ColorDict directly')).toBeVisible()
  await page.getByRole('radio', { name: 'Choose app' }).click()
  await expect(page.getByTestId('dictionary')).toContainText('Al-eese')
  await shot(page, info, 'settings-light')
  await importFile(page, 'alice.epub')
  const spoken = await page.evaluate(() => (window as unknown as { __lumen: { session(): { index: { sentences: Array<{ spoken: { text: string } }> } } } }).__lumen.session().index.sentences[1].spoken.text)
  expect(spoken).toMatch(/^Al-eese was beginning/)
  await page.getByTestId('more-button').click()
  await page.getByTestId('menu-sleep').click()
  await page.getByRole('button', { name: '15 minutes' }).click()
  await page.getByTestId('more-button').click()
  await page.getByTestId('menu-sleep').click()
  await expect(page.getByTestId('sleep-sheet')).toContainText(/Stops in 1[45] min/)
})

test('desktop keyboard shortcuts', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop only')
  await importFile(page, 'alice.epub')
  await page.keyboard.press('Space')
  await expect.poll(() => playerInfo(page).then((p) => p.state)).toBe('playing')
  const i = (await playerInfo(page)).index
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => playerInfo(page).then((p) => p.index)).toBe(i + 1)
  await page.keyboard.press('Shift+ArrowRight')
  await expect.poll(() => sentenceHighlight(page)).toBe('Chapter II. The Pool of Tears')
  await page.keyboard.press('=')
  await page.keyboard.press('=')
  expect((await playerInfo(page)).speed).toBe(1.2)
  await page.keyboard.press('-')
  expect((await playerInfo(page)).speed).toBe(1.1)
  await page.keyboard.press('Space')
  await expect.poll(() => playerInfo(page).then((p) => p.state)).toBe('paused')
  await page.getByTestId('speed-button').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('speed-sheet')).toBeHidden()
})
