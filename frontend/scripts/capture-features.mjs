// One screenshot per feature at 1440 × 900, for docs/scope.md. Read-only:
// pages are only opened, nothing is submitted.
//
//   node scripts/capture-features.mjs [base URL] [--only name,name] [--suffix text]
//
// The base URL defaults to the live app. The "server is waking up" state is
// always captured from a local preview of the built site (npm run build first)
// whose backend is not running, as in e2e/servers.js.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
const BASE = (args.find((a) => a.startsWith('http')) || 'https://iamglory-bilharz.hf.space').replace(/\/$/, '')
const only = option('--only')?.split(',')
const suffix = option('--suffix') ? `-${option('--suffix')}` : ''
const OUT = new URL('../../docs/evidence/features/', import.meta.url)
const OFFLINE_PORT = 4175
const DEAD_API_PORT = 8019

// A slow start (a sleeping Space) can take a minute or more.
const READY_MS = 180_000

const tilesLoaded = (selector) => async (page) => {
  await page.locator(selector).first().waitFor({ timeout: READY_MS })
  await page.waitForFunction(
    (s) => [...document.querySelectorAll(s)].every((img) => img.complete && img.naturalWidth > 0),
    selector,
    { timeout: READY_MS },
  )
}
const visible = (selector) => (page) => page.locator(selector).first().waitFor({ timeout: READY_MS })

const FEATURES = [
  { name: 'landing', path: '/', ready: visible('h1') },
  { name: 'queue', path: '/queue', ready: visible('.queue__table tbody tr') },
  { name: 'result-dt40-referred', path: '/samples/DT40', ready: tilesLoaded('.result__tiles img') },
  { name: 'result-dt02-negative', path: '/samples/DT02', ready: tilesLoaded('.result__tiles img') },
  { name: 'result-dt29-positive', path: '/samples/DT29', ready: tilesLoaded('.result__tiles img') },
  {
    name: 'review-dt40-egg-guide',
    path: '/review/DT40',
    ready: async (page) => {
      await tilesLoaded('.review__tiles img')(page)
      await page.locator('.egg-guide[open]').waitFor({ timeout: READY_MS })
    },
  },
  { name: 'reviews', path: '/reviews', ready: visible('.reviews__table, .reviews__empty') },
  { name: 'performance', path: '/performance', ready: visible('.perf__stats') },
  {
    name: 'analyse',
    path: '/analyse',
    // Options in a closed menu are never "visible": wait for the list to be filled.
    ready: (page) => page.locator('#sample-select option:nth-child(2)').waitFor({ state: 'attached', timeout: READY_MS }),
  },
]

async function capture(browser, base, { name, path, ready }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  try {
    await page.goto(base + path, { timeout: READY_MS })
    await ready(page)
    await page.evaluate(() => document.fonts.ready)
    const file = new URL(`${name}${suffix}.jpg`, OUT)
    await page.screenshot({ path: file.pathname, type: 'jpeg', quality: 80 })
    console.log(`saved docs/evidence/features/${name}${suffix}.jpg  (${base + path})`)
  } finally {
    await context.close()
  }
}

async function offlinePreview() {
  const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(OFFLINE_PORT), '--strictPort'], {
    env: { ...process.env, BILHARZ_API_TARGET: `http://127.0.0.1:${DEAD_API_PORT}` },
    stdio: 'ignore',
  })
  const url = `http://127.0.0.1:${OFFLINE_PORT}`
  for (let i = 0; i < 50; i++) {
    if (await fetch(url).then((r) => r.ok, () => false)) return { url, server }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  server.kill()
  throw new Error('the local preview did not start')
}

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
try {
  for (const feature of FEATURES) {
    if (!only || only.includes(feature.name)) await capture(browser, BASE, feature)
  }
  if (!only || only.includes('server-waking-up')) {
    const { url, server } = await offlinePreview()
    try {
      await capture(browser, url, {
        name: 'server-waking-up',
        path: '/queue',
        ready: async (page) => {
          await page.getByRole('alert').filter({ hasText: 'The server is waking up' }).waitFor({ timeout: READY_MS })
        },
      })
    } finally {
      server.kill()
    }
  }
} finally {
  await browser.close()
}
