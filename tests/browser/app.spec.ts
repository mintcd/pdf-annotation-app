import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type {} from '../fixtures/viewer/app'

// These are real React/sidebar/controller flows with a test-only row store.
// The separate mobile controller suite exercises CDP touch input.
test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false })

async function snapshot(page: Page) {
  return page.evaluate(() => window.pdfAppHarness.snapshot())
}

async function openApp(page: Page, seed = false) {
  await page.goto(`/app.html${seed ? '?seed=1' : ''}`)
  await expect(page.locator('.page[data-page-number="1"] canvas').first()).toBeVisible()
  await expect(page.locator('.page[data-page-number="1"] .textLayer')).toContainText('Select this first page')
  await expect.poll(async () => (await snapshot(page)).tables.documents.length).toBe(1)
  await expect.poll(async () => (await snapshot(page)).tables.highlight_colors.length).toBe(4)
  await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeEnabled()
}

async function selectFirstPageText(page: Page) {
  await page.evaluate(() => {
    const span = Array.from(document.querySelectorAll('.page[data-page-number="1"] .textLayer span'))
      .find((element) => element.textContent?.includes('Select this first page'))
    if (!span) throw new Error('The source text layer is missing')
    const range = document.createRange()
    range.selectNodeContents(span)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
  await expect(page.getByRole('toolbar', { name: 'Text selection actions' })).toBeVisible()
}

test('React selection, sidebar editing and undo/redo update local rows, overlays and counts', async ({ page }) => {
  await openApp(page)
  await selectFirstPageText(page)
  await page.getByRole('button', { name: 'Highlight Reference', exact: true }).click()
  await expect.poll(async () => (await snapshot(page)).tables.annotations.length).toBe(1)
  await expect.poll(async () => (await snapshot(page)).tables.documents[0].number_of_annotations).toBe(1)
  await expect(page.locator('.app-highlight').first()).toBeVisible()
  const inserted = (await snapshot(page)).tables.annotations[0]
  expect(inserted.text).toContain('Select this first page')
  expect(JSON.parse(String(inserted.position))).toMatchObject({ version: 1, kind: 'pdf-highlight', pageIndex: 0 })

  await page.getByRole('button', { name: 'Open annotations' }).click()
  const sidebar = page.getByRole('complementary', { name: 'PDF annotations' })
  await sidebar.locator('.annotation-summary').click()
  await sidebar.getByRole('radio', { name: 'Confirmed highlight (#90ee90)', exact: true }).click()
  await expect.poll(async () => (await snapshot(page)).tables.annotations[0].color).toBe('#90ee90')
  const note = sidebar.getByRole('textbox', { name: 'Note for page 1' })
  await note.fill('A note saved through the real sidebar')
  await sidebar.getByRole('radio', { name: 'Confirmed highlight (#90ee90)', exact: true }).focus()
  await expect.poll(async () => (await snapshot(page)).tables.annotations[0].comment).toBe('A note saved through the real sidebar')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(async () => (await snapshot(page)).tables.annotations[0].comment).toBeNull()
  await expect(note).toHaveText('')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect.poll(async () => (await snapshot(page)).tables.annotations[0].comment).toBe('A note saved through the real sidebar')
  await expect(note).toContainText('A note saved through the real sidebar')

  await sidebar.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect.poll(async () => (await snapshot(page)).tables.annotations.length).toBe(0)
  await expect.poll(async () => (await snapshot(page)).tables.documents[0].number_of_annotations).toBe(0)
  await expect(page.locator('.app-highlight')).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(async () => (await snapshot(page)).tables.annotations.length).toBe(1)
  await expect.poll(async () => (await snapshot(page)).tables.documents[0].number_of_annotations).toBe(1)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect.poll(async () => (await snapshot(page)).tables.documents[0].number_of_annotations).toBe(0)
  expect((await snapshot(page)).syncCalls).toBeGreaterThan(0)
})

test('existing v1 annotations and sidebar edits restore after the React reader reloads', async ({ page }) => {
  await openApp(page, true)
  const sidebar = page.getByRole('complementary', { name: 'PDF annotations' })
  await expect(sidebar).toBeVisible()
  await expect(page.locator('.app-highlight.is-selected')).toBeVisible()
  const position = (await snapshot(page)).tables.annotations[0].position
  await sidebar.getByRole('radio', { name: 'Concern highlight (#ff6b6b)', exact: true }).click()
  await expect.poll(async () => (await snapshot(page)).tables.annotations[0].color).toBe('#ff6b6b')
  await page.reload()
  await expect(page.locator('.page[data-page-number="1"] canvas').first()).toBeVisible()
  await expect(sidebar).toBeVisible()
  await expect(sidebar.getByRole('textbox', { name: 'Note for page 1' })).toContainText('Saved earlier')
  await expect(page.locator('.app-highlight.is-selected')).toBeVisible()
  const restored = (await snapshot(page)).tables.annotations[0]
  expect(restored.id).toBe('existing-v1')
  expect(restored.color).toBe('#ff6b6b')
  expect(restored.position).toEqual(position)
  expect((await snapshot(page)).tables.documents[0].number_of_annotations).toBe(1)
})

test('undo preserves an incoming changed annotation and clears stale session history', async ({ page }) => {
  await openApp(page, true)
  const sidebar = page.getByRole('complementary', { name: 'PDF annotations' })
  await sidebar.getByRole('radio', { name: 'Confirmed highlight (#90ee90)', exact: true }).click()
  await expect.poll(async () => (await snapshot(page)).tables.annotations[0].color).toBe('#90ee90')
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
  await page.evaluate(() => window.pdfAppHarness.receiveAnnotationPatch('existing-v1', {
    comment: 'A note received from another client', updated_at: '2026-10-18T12:00:00.000Z',
  }))
  await expect(sidebar.getByRole('textbox', { name: 'Note for page 1' })).toContainText('A note received from another client')
  const before = await snapshot(page)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('This annotation changed elsewhere')
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled()
  const after = await snapshot(page)
  expect(after.tables.annotations[0]).toEqual(before.tables.annotations[0])
  expect(after.writes).toEqual(before.writes)
  expect(after.tables.documents[0].number_of_annotations).toBe(1)
})

test('outline authoring and Download export the real React workspace state', async ({ page }) => {
  await openApp(page, true)
  await page.getByRole('button', { name: 'Open table of contents', exact: true }).click()
  const outline = page.getByRole('complementary', { name: 'PDF table of contents' })
  await expect(outline.getByRole('button', { name: 'First chapter Page 1', exact: true })).toBeVisible()
  await outline.getByRole('button', { name: 'Add outline', exact: true }).click()
  await outline.getByLabel('Name', { exact: true }).fill('Chapter created in React')
  await outline.getByLabel('Page', { exact: true }).fill('3')
  await outline.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(outline.getByRole('button', { name: 'Chapter created in React Page 3', exact: true })).toBeVisible()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download', exact: true }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('react-integration.pdf')
  const bytes = await readFile((await download.path())!)
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
  try {
    const exported = await loading.promise
    const bookmarks = await exported.getOutline()
    expect(bookmarks.map((entry) => entry.title)).toEqual(['First chapter', 'Last chapter', 'Chapter created in React'])
    const annotations = await (await exported.getPage(1)).getAnnotations()
    const saved = annotations.find((annotation) => annotation.subtype === 'Highlight')
    expect(saved).toMatchObject({ contentsObj: { str: 'Saved earlier' }, color: new Uint8ClampedArray([135, 206, 235]) })
    expect(exported.numPages).toBe(3)
  } finally { await loading.destroy() }
})
