// Loading times in Chromium, without throttling and on a simulated low-end
// phone (4x CPU slowdown, Slow 3G network), plus the layout shift of the
// landing page while its fonts load.
//
//   node scripts/measure-loading.mjs [base URL] [--runs n] [--only-shift] [--save name]
//
// The base URL defaults to the local preview (http://127.0.0.1:4173, see
// e2e/servers.js). Each case runs in a fresh browser context, so nothing is
// cached between runs. With --save, results go to
// docs/evidence/performance/<name>.json.
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
const save = args.includes('--save') ? args[args.indexOf('--save') + 1] : null
const BASE = (args.find((a) => a.startsWith('http')) || 'http://127.0.0.1:4173').replace(/\/$/, '')
const RUNS = args.includes('--runs') ? Number(args[args.indexOf('--runs') + 1]) : 3
const onlyShift = args.includes('--only-shift')

// Chrome DevTools' "Slow 3G": 400 kbit/s each way, 2 s round trips.
const SLOW_3G = { offline: false, downloadThroughput: 50_000, uploadThroughput: 50_000, latency: 2000 }
// Lighthouse's desktop profile: 10 Mbit/s, 40 ms round trips.
const DESKTOP_NETWORK = { offline: false, downloadThroughput: 1_250_000, uploadThroughput: 1_250_000, latency: 40 }

const PROFILES = {
  none: { viewport: { width: 390, height: 844 }, cpu: 1, network: null },
  'low-end': { viewport: { width: 390, height: 844 }, cpu: 4, network: SLOW_3G },
}

async function open(browser, { viewport, cpu, network }) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
  if (network) {
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', network)
  }
  return { context, page }
}

const loaded = (img) => img.complete && img.naturalWidth > 0

// On a timeout, say what the page showed and which requests failed.
async function explained(page, step) {
  const failed = []
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`))
  try {
    return await step()
  } catch (error) {
    const shown = await page.locator('main').innerText().catch(() => '(no main element)')
    throw new Error(`${error.message.split('\n')[0]}\npage shows: ${shown.slice(0, 300)}\nfailed requests: ${failed.join('; ') || 'none'}`)
  }
}

async function queueTable(page) {
  return explained(page, async () => {
    const start = Date.now()
    await page.goto(`${BASE}/queue`, { waitUntil: 'commit' })
    await page.locator('.queue__table tbody tr').first().waitFor({ timeout: 180_000 })
    return { table_ms: Date.now() - start }
  })
}

async function reviewTiles(page) {
  return explained(page, () => reviewTilesSteps(page))
}

async function reviewTilesSteps(page) {
  const start = Date.now()
  await page.goto(`${BASE}/review/DT40`, { waitUntil: 'commit' })
  const first = page.locator('.review__tiles img').first()
  await first.waitFor({ timeout: 180_000 })
  await page.waitForFunction((img) => img.complete && img.naturalWidth > 0, await first.elementHandle(), { timeout: 180_000 })
  const firstTile = Date.now() - start
  // The rest load lazily as the reviewer scrolls down to them.
  for (const img of await page.locator('.review__tiles img').all()) {
    await img.scrollIntoViewIfNeeded()
    await page.waitForFunction(loaded, await img.elementHandle(), { timeout: 180_000 })
  }
  return { first_tile_ms: firstTile, all_12_tiles_ms: Date.now() - start }
}

async function landingShift(browser) {
  const { context, page } = await open(browser, { viewport: { width: 1440, height: 900 }, cpu: 1, network: DESKTOP_NETWORK })
  await page.addInitScript(() => {
    window.__shift = 0
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__shift += entry.value
    }).observe({ type: 'layout-shift', buffered: true })
  })
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  const shift = await page.evaluate(() => window.__shift)
  await context.close()
  return Number(shift.toFixed(3))
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

const browser = await chromium.launch()
const results = { base: BASE, browser: `Chromium ${browser.version()}`, runs: RUNS, profiles: {} }
for (const [name, profile] of onlyShift ? [] : Object.entries(PROFILES)) {
  const runs = []
  for (let i = 0; i < RUNS; i++) {
    const queue = await open(browser, profile)
    const q = await queueTable(queue.page)
    await queue.context.close()
    const review = await open(browser, profile)
    const r = await reviewTiles(review.page)
    await review.context.close()
    runs.push({ ...q, ...r })
    console.log(name, i + 1, JSON.stringify(runs.at(-1)))
  }
  results.profiles[name] = {
    viewport: profile.viewport,
    cpu_slowdown: profile.cpu,
    network: profile.network ? 'Slow 3G (400 kbit/s, 2 s round trip)' : 'none',
    median: Object.fromEntries(Object.keys(runs[0]).map((k) => [k, median(runs.map((r) => r[k]))])),
    runs,
  }
}
const shifts = []
for (let i = 0; i < RUNS; i++) shifts.push(await landingShift(browser))
results.landing_layout_shift = { viewport: '1440x900', network: '10 Mbit/s, 40 ms', runs: shifts, median: median(shifts) }
console.log('landing layout shift', shifts)
await browser.close()

if (save) {
  const dir = new URL('../../docs/evidence/performance/', import.meta.url)
  mkdirSync(dir, { recursive: true })
  writeFileSync(new URL(`${save}.json`, dir), JSON.stringify({ ...results, measured_at: new Date().toISOString() }, null, 2) + '\n')
  console.log(`saved docs/evidence/performance/${save}.json`)
}
