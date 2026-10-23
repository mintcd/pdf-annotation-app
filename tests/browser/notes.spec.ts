import { expect, test } from '@playwright/test'

test('saved notes follow undo and remote values without stale blur writes', async ({ page }) => {
  await page.goto('/notes.html')
  const note = page.getByRole('textbox', { name: 'Note for page 1' })
  const outside = page.getByRole('button', { name: 'Outside editor' })
  await expect(note).toHaveText('Original note')
  await note.fill('First edit')
  await outside.click()
  await expect.poll(() => page.evaluate(() => window.notesHarness.saves())).toEqual(['First edit'])
  await expect(note).toHaveText('First edit')

  await page.evaluate(() => window.notesHarness.replace('Undone note'))
  await expect(note).toHaveText('Undone note')
  await outside.click()
  expect(await page.evaluate(() => window.notesHarness.saves())).toEqual(['First edit'])

  await note.focus()
  await page.evaluate(() => window.notesHarness.replace('Remote note'))
  await outside.click()
  await expect(note).toHaveText('Remote note')
  expect(await page.evaluate(() => window.notesHarness.saves())).toEqual(['First edit'])
})

test('an active dirty note does not overwrite a note changed elsewhere on blur', async ({ page }) => {
  await page.goto('/notes.html')
  const note = page.getByRole('textbox', { name: 'Note for page 1' })
  await expect(note).toHaveText('Original note')
  await note.fill('Unsaved draft')
  await page.evaluate(() => window.notesHarness.replace('Changed elsewhere'))
  await expect(note).toHaveText('Unsaved draft')
  await page.getByRole('button', { name: 'Outside editor' }).click()
  await expect(note).toHaveText('Changed elsewhere')
  expect(await page.evaluate(() => window.notesHarness.saves())).toEqual([])
})
