import { expect, test } from '@playwright/test'
import { EVIDENCE, record } from './results.js'

const PAGES = [
  { key: 'landing', path: '/' },
  { key: 'analyse', path: '/analyse' },
  { key: 'queue', path: '/queue' },
  { key: 'result', path: '/samples/DT40', tiles: '.result__tiles img' },
  { key: 'review', path: '/review/DT40', tiles: '.review__tiles img' },
  { key: 'reviews', path: '/reviews' },
  { key: 'performance', path: '/performance' },
  { key: 'not-found', path: '/no-such-page' },
]

const screenshots = process.env.BILHARZ_COMPAT_SCREENSHOTS === '1'

for (const { key, path, tiles } of PAGES) {
  test(key, async ({ page, browser, browserName }, testInfo) => {
    const viewport = page.viewportSize()
    const errors = []
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
    page.on('pageerror', (error) => errors.push(error.message))

    const started = Date.now()
    await page.goto(path)
    // Every page's own heading appears once its data has loaded.
    await expect(page.locator('main h1').first()).toBeVisible({ timeout: 60_000 })
    const loadMs = Date.now() - started

    await expect(page.locator('header.header')).toBeVisible()

    let tilesLoaded = ''
    if (tiles) {
      const images = page.locator(tiles)
      await expect(images.first()).toBeVisible()
      for (const image of await images.all()) {
        await image.scrollIntoViewIfNeeded()
        await expect.poll(() => image.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true)
      }
      tilesLoaded = await images.count()
      await page.evaluate(() => window.scrollTo(0, 0))
    }

    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    // Copied before the screenshot: Playwright injects a <style> to hide the
    // caret while capturing, which a strict CSP blocks with a console error of its own.
    const pageErrors = [...errors]
    const passed = documentWidth <= viewport.width && pageErrors.length === 0
    record([browserName, browser.version(), `${viewport.width}x${viewport.height}`, key, loadMs, documentWidth, pageErrors.length, tilesLoaded, passed])

    if (screenshots) {
      await page.screenshot({ path: `${EVIDENCE}${browserName}-${viewport.width}-${key}.jpg`, type: 'jpeg', quality: 70 })
    }
    testInfo.annotations.push({ type: 'console errors', description: pageErrors.join(' | ') })
    expect(pageErrors, 'console errors').toEqual([])
    expect(documentWidth, 'document width').toBeLessThanOrEqual(viewport.width)
  })
}
