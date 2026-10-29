import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { OFFLINE_APP_URL } from './servers.js'

// Real images from scripts/fetch_samples.py; the upload test is skipped without them.
const DT40_IMAGES = fileURLToPath(new URL('../../test-data/samples/DT40', import.meta.url))
const hasDt40 = existsSync(DT40_IMAGES) && readdirSync(DT40_IMAGES).filter((f) => f.endsWith('.jpeg')).length === 117

test.describe.configure({ mode: 'serial' })

async function waitingCount(page) {
  const text = await page.locator('.header__waiting').textContent()
  return Number(text.match(/\d+/)[0])
}

test('the queue shows the stored decisions', async ({ page }) => {
  await page.goto('/queue')
  await expect(page.getByRole('heading', { level: 1, name: 'Queue' })).toBeVisible()
  await expect(page.locator('.page-header')).toContainText('65 samples · 48 waiting for a technician')
  const tab = (name) => page.getByRole('group', { name: 'Filter by decision' }).getByRole('button', { name })
  await expect(tab(/^Referred/)).toContainText('48')
  await expect(tab(/^Negative/)).toContainText('10')
  await expect(tab(/^Positive/)).toContainText('7')
  await expect(page.locator('.queue__table tbody tr')).toHaveCount(65)
  expect(await waitingCount(page)).toBe(48)
})

async function expectQueueCounts(page, referred, negative, positive) {
  const tab = (name) => page.getByRole('group', { name: 'Filter by decision' }).getByRole('button', { name })
  await expect(tab(/^Referred/)).toContainText(String(referred))
  await expect(tab(/^Negative/)).toContainText(String(negative))
  await expect(tab(/^Positive/)).toContainText(String(positive))
  await expect.poll(() => waitingCount(page)).toBe(referred)
}

test('switching the decision setting updates the queue and the results', async ({ page }) => {
  await page.goto('/performance')
  await page.getByRole('group', { name: 'Decision setting' }).getByRole('button', { name: 'Efficiency' }).click()
  await page.getByRole('button', { name: 'Use this setting in the app' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Efficiency is the setting in use in the app.' })).toBeVisible()

  await page.goto('/queue')
  await expectQueueCounts(page, 33, 20, 12)
  await expect(page.getByText('Decisions from the Efficiency setting.')).toBeVisible()

  await page.goto('/samples/DT40')
  await expect(page.getByText('score above 0.99', { exact: true })).toBeVisible()
  await expect(page.getByText('Counted tiles score above 0.99 and decide the outcome.')).toBeVisible()
  await expect(page.locator('.scale__labels')).toContainText('1–12 · referred')

  // Back through the menu's Change link, to the Safety setting.
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(page.locator('.sidebar__setting')).toContainText('Efficiency')
  await page.locator('.sidebar__setting').getByRole('link', { name: 'Change' }).click()
  await expect(page).toHaveURL(/\/performance#use-setting$/)
  await page.getByRole('group', { name: 'Decision setting' }).getByRole('button', { name: /^Safety/ }).click()
  await page.getByRole('button', { name: 'Use this setting in the app' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Safety is the setting in use in the app.' })).toBeVisible()

  await page.goto('/samples/DT40')
  await expect(page.getByText('score above 0.95', { exact: true })).toBeVisible()
  await expect(page.locator('.scale__labels')).toContainText('1–35 · referred')
  await page.goto('/queue')
  await expectQueueCounts(page, 48, 10, 7)
})

test("DT40's tiles load on its review page", async ({ page }) => {
  await page.goto('/review/DT40')
  const tiles = page.locator('.review__tiles img')
  await expect(tiles).toHaveCount(12)
  for (const tile of await tiles.all()) {
    await tile.scrollIntoViewIfNeeded()
    await expect.poll(() => tile.evaluate((img) => img.complete && img.naturalWidth)).toBe(256)
  }
})

test('recording a review updates the waiting count and the Reviews page', async ({ page }) => {
  await page.goto('/review/DT40')
  await page.getByRole('button', { name: /^Infected/ }).click()
  await page.getByLabel('Note (optional)').fill('One egg in the top tile')
  await page.getByRole('button', { name: 'Record decision' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Decision recorded for DT40' })).toBeVisible()
  await expect.poll(() => waitingCount(page)).toBe(47)

  await page.goto('/reviews')
  const row = page.locator('.reviews__table tbody tr', { hasText: 'DT40' })
  await expect(row).toContainText('Infected')
  await expect(row).toContainText('One egg in the top tile')
  await expect(page.locator('.page-header')).toContainText('1 reviewed · 1 infected · 0 healthy')
})

test('editing a review adds a new version and keeps the old one', async ({ page }) => {
  await page.goto('/review/DT40?edit=1')
  await expect(page.getByLabel('Note (optional)')).toHaveValue('One egg in the top tile')
  await page.getByRole('button', { name: /^Healthy/ }).click()
  await page.getByLabel('Note (optional)').fill('Debris, not an egg')
  await page.getByRole('button', { name: 'Save changes' }).click()

  await expect(page).toHaveURL(/\/reviews$/)
  await expect(page.getByText('Review updated for DT40.')).toBeVisible()
  const row = page.locator('.reviews__table tbody tr', { hasText: 'DT40' })
  await expect(row).toContainText('Healthy')
  await row.getByRole('button', { name: '2 versions' }).click()
  const replaced = page.locator('.reviews__old')
  await expect(replaced).toContainText('Replaced')
  await expect(replaced).toContainText('Infected')
  await expect(replaced).toContainText('One egg in the top tile')
})

test('export with a wrong token shows the error and keeps nothing', async ({ page }) => {
  await page.goto('/reviews')
  await page.getByRole('button', { name: 'Export CSV' }).click()
  await page.getByLabel('Admin token').fill('not-the-token')
  await page.getByRole('button', { name: 'Download' }).click()
  await expect(page.getByRole('alert')).toHaveText("That token isn't valid.")
  await expect(page.getByLabel('Admin token')).toHaveValue('')
  const kept = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]))
  expect(kept).not.toContain('not-the-token')
})

test('uploading the real DT40 sample gives a result with its timing', async ({ page }) => {
  test.skip(!hasDt40, 'run scripts/fetch_samples.py DT40 first')
  test.setTimeout(180_000)
  await page.goto('/analyse')
  await page.locator('#sample-images').setInputFiles(DT40_IMAGES)
  await expect(page.getByText('117 images selected. Ready to analyse.')).toBeVisible()
  await page.getByRole('button', { name: 'Analyse 117 images' }).click()

  await expect(page).toHaveURL(/\/samples\/upload$/, { timeout: 150_000 })
  await expect(page.getByText(/^Analysed in \d+\.\d s$/)).toBeVisible()
  await expect(page.getByText('Referred to a technician')).toBeVisible()
  await expect(page.locator('.result__tiles img')).toHaveCount(6)
})

test('with the backend stopped, the app says the server is waking up', async ({ page }) => {
  await page.goto(`${OFFLINE_APP_URL}/queue`)
  await expect(page.getByRole('alert')).toContainText('The server is waking up. This can take up to a minute.')
  await expect(page.getByText('Trying again automatically in a few seconds.')).toBeVisible()
})
