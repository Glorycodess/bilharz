import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { ADMIN_TOKEN, APP_URL, OFFLINE_APP_URL } from './servers.js'

// Real images from scripts/fetch_samples.py; the upload test is skipped without them.
const DT40_IMAGES = fileURLToPath(new URL('../../test-data/samples/DT40', import.meta.url))
const hasDt40 = existsSync(DT40_IMAGES) && readdirSync(DT40_IMAGES).filter((f) => f.endsWith('.jpeg')).length === 117

test.describe.configure({ mode: 'serial' })

// Sign this browser in as an approved reviewer (an admin, made with the admin
// token), through the API: the session cookie is shared with the page. The
// sign-in screens are tested on their own.
const REVIEWER = { name: 'E2E Reviewer', email: 'e2e@example.org', password: 'end to end passphrase' }

const PLAIN = { name: 'Plain Reviewer', email: 'plain@example.org', password: 'another long passphrase' }
const ORIGIN = { Origin: APP_URL }

// Sign in `api` (a page's request context, or a separate one) as `who`,
// creating the account the first time; returns the account.
async function signIn(api, who) {
  const signIn = await api.post('/api/auth/signin', { headers: ORIGIN, data: { email: who.email, password: who.password } })
  if (signIn.status() !== 401) {
    expect(signIn.status()).toBe(200)
    return signIn.json()
  }
  const signUp = await api.post('/api/auth/signup', { headers: ORIGIN, data: who })
  expect(signUp.status()).toBe(201)
  return signUp.json()
}

async function signInAsReviewer(page) {
  await signIn(page.request, REVIEWER)
  const claim = await page.request.post('/api/admin/claim', { headers: { ...ORIGIN, 'X-Admin-Token': ADMIN_TOKEN } })
  expect(claim.status(), await claim.text()).toBe(200)
}

// An approved reviewer who is not an admin, approved by the admin in `adminApi`.
async function signInAsPlainReviewer(page, adminApi) {
  await signIn(adminApi, REVIEWER)
  const claim = await adminApi.post('/api/admin/claim', { headers: { ...ORIGIN, 'X-Admin-Token': ADMIN_TOKEN } })
  expect(claim.status()).toBe(200)
  const account = await signIn(page.request, PLAIN)
  const approve = await adminApi.post(`/api/admin/accounts/${account.id}/approve`, { headers: ORIGIN })
  expect(approve.status()).toBe(200)
}

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
  await expect(page.locator('.result__explain')).toContainText(
    'too many to clear and too few to confirm (confirming takes more than 12 under the Efficiency setting)',
  )

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
  await expect(page.locator('.result__explain')).toContainText('more than 35 under the Safety setting')
  await page.goto('/queue')
  await expectQueueCounts(page, 48, 10, 7)
})

test('the first-time guide can be hidden, stays hidden after a reload, and comes back', async ({ page }) => {
  await page.goto('/')
  const guide = page.getByRole('region', { name: 'New to Bilharz?' })
  await expect(guide).toBeVisible()
  await guide.getByRole('button', { name: 'Got it, hide this' }).click()
  await expect(guide).toBeHidden()
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(guide).toBeHidden()
  await page.getByRole('button', { name: 'Show the first-time guide' }).click()
  await expect(guide).toBeVisible()
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
  await signInAsReviewer(page)
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
  await expect(row).toContainText(REVIEWER.name) // from the session, not the form
  await expect(page.locator('.page-header')).toContainText('1 reviewed · 1 infected · 0 healthy')
})

test('a reviewed sample offers editing instead of a second review', async ({ page }) => {
  await signInAsReviewer(page)
  await page.goto('/review/DT40')
  await expect(page.getByRole('heading', { name: 'Already reviewed' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Record decision' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Edit the review' }).click()
  await expect(page).toHaveURL(/\/review\/DT40\?edit=1$/)
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible()
})

test('editing a review adds a new version and keeps the old one', async ({ page }) => {
  await signInAsReviewer(page)
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

test('export with a wrong token shows the error and keeps nothing', async ({ page, request }) => {
  await signInAsPlainReviewer(page, request)
  await page.goto('/reviews')
  await page.getByRole('button', { name: 'Export CSV' }).click()
  await page.getByLabel('Admin token').fill('not-the-token')
  await page.getByRole('button', { name: 'Download' }).click()
  await expect(page.getByRole('alert')).toHaveText("That token isn't valid.")
  await expect(page.getByLabel('Admin token')).toHaveValue('')
  const kept = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]))
  expect(kept).not.toContain('not-the-token')
})

// Accounts, through the screens ---------------------------------------------

const GRACE = { name: 'Grace Mensah', email: 'grace@example.org', password: 'grace first passphrase' }

async function signInThroughTheForm(page, who) {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(who.email)
  await page.getByLabel('Password', { exact: true }).fill(who.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/queue$/)
}

test('the first admin is made on the Admin page with the admin token', async ({ page }) => {
  const owner = { name: 'Project Owner', email: 'owner@example.org', password: 'owner long passphrase' }
  await page.goto('/sign-up')
  await page.getByLabel('Name').fill(owner.name)
  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password', { exact: true }).fill(owner.password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('status')).toContainText('An admin has to approve your account')

  await page.goto('/admin')
  await page.getByLabel('Admin token').fill('not-the-token')
  await page.getByRole('button', { name: 'Make me an admin' }).click()
  await expect(page.getByRole('alert')).toHaveText("That admin token isn't valid.")
  await expect(page.getByLabel('Admin token')).toHaveValue('')

  await page.getByLabel('Admin token').fill(ADMIN_TOKEN)
  await page.getByRole('button', { name: 'Make me an admin' }).click()
  await expect(page.getByRole('region', { name: 'Accounts' })).toContainText('owner@example.org')
  // The menu now has Admin, and says who is signed in.
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible()
  await expect(page.locator('.sidebar__account')).toContainText('Project Owner')
})

test('a new reviewer waits for approval, an admin approves them, and they review under their name', async ({
  page,
  browser,
}) => {
  const samples = (await (await page.request.get('/api/samples')).json()).samples
  const sample = samples.find((s) => s.decision === 'referred' && !s.review && s.id !== 'DT40').id

  await page.goto(`/review/${sample}`)
  await expect(page.getByRole('heading', { name: 'Sign in to record reviews' })).toBeVisible()
  await page.getByRole('link', { name: 'Create an account' }).click()
  await page.getByLabel('Name').fill(GRACE.name)
  await page.getByLabel('Email').fill(GRACE.email)
  await page.getByLabel('Password', { exact: true }).fill(GRACE.password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByRole('link', { name: 'Continue' }).click()
  await expect(page).toHaveURL(new RegExp(`/review/${sample}$`))
  await expect(page.getByRole('heading', { name: 'Waiting for approval' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Record decision' })).toHaveCount(0)

  // The admin, in another browser, signs in through the form and approves Grace.
  const adminContext = await browser.newContext()
  const admin = await adminContext.newPage()
  await signInThroughTheForm(admin, REVIEWER)
  await admin.goto('/admin')
  await admin.getByRole('button', { name: `Approve ${GRACE.name}` }).click()
  await expect(admin.getByRole('row', { name: new RegExp(GRACE.name) })).toContainText('Approved')
  await adminContext.close()

  await page.reload()
  await page.getByRole('button', { name: /^Healthy/ }).click()
  await page.getByRole('button', { name: 'Record decision' }).click()
  await expect(page.getByRole('status').filter({ hasText: `Decision recorded for ${sample}` })).toBeVisible()
  await page.goto('/reviews')
  await expect(page.locator('.reviews__table tbody tr', { hasText: sample })).toContainText(GRACE.name)
})

test('a reset link from the Admin page sets a new password once', async ({ page, browser }) => {
  const adminContext = await browser.newContext()
  const admin = await adminContext.newPage()
  await signInThroughTheForm(admin, REVIEWER)
  await admin.goto('/admin')
  await admin.getByRole('button', { name: `Make a reset link for ${GRACE.name}` }).click()
  const url = await admin.getByRole('textbox', { name: `Reset link for ${GRACE.name}` }).inputValue()
  expect(url).toMatch(new RegExp(`^${APP_URL}/reset-password#token=[A-Za-z0-9_-]{43}$`))
  await adminContext.close()

  await page.goto(url)
  await expect(page.getByLabel('New password')).toBeVisible()
  expect(new URL(page.url()).hash).toBe('') // the token left the address bar at once
  await page.getByLabel('New password').fill('grace second passphrase')
  await page.getByRole('button', { name: 'Set password' }).click()
  await expect(page.getByRole('status')).toContainText('Your password is changed')

  // The old password no longer works; the new one does.
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(GRACE.email)
  await page.getByLabel('Password', { exact: true }).fill(GRACE.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toHaveText('The email or password is wrong.')
  await signInThroughTheForm(page, { ...GRACE, password: 'grace second passphrase' })

  // The link works once.
  await page.goto(url)
  await page.getByLabel('New password').fill('grace third passphrase')
  await page.getByRole('button', { name: 'Set password' }).click()
  await expect(page.getByRole('alert')).toContainText('not valid or has expired')
})

test('inside another page, signing in is offered in a new tab', async ({ page }) => {
  // about:blank is another origin than the app, as huggingface.co is.
  await page.setContent(`<iframe src="${APP_URL}/review/DT40" width="1200" height="900"></iframe>`)
  const frame = page.frameLocator('iframe')
  const link = frame.getByRole('link', { name: 'Open Bilharz in a new tab' })
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('href', `${APP_URL}/sign-in?next=%2Freview%2FDT40`)
  await expect(frame.getByRole('button', { name: 'Record decision' })).toHaveCount(0)

  await page.setContent(`<iframe src="${APP_URL}/sign-in" width="1200" height="900"></iframe>`)
  await expect(page.frameLocator('iframe').getByRole('link', { name: 'Open Bilharz in a new tab' })).toBeVisible()
  await expect(page.frameLocator('iframe').getByLabel('Password')).toHaveCount(0)
})

test('signing out from the menu brings back the sign-in prompt', async ({ page }) => {
  await signInThroughTheForm(page, { ...GRACE, password: 'grace second passphrase' })
  await page.goto('/reviews')
  await expect(page.locator('.reviews__table')).toBeVisible()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in to see the reviews' })).toBeVisible()
  await expect(page.locator('.reviews__table')).toHaveCount(0)
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
