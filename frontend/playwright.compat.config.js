import { defineConfig } from '@playwright/test'
import { APP_URL, webServer } from './e2e/servers.js'

// Cross-browser and screen-size checks: `npm run test:compat`.
// Against the local build by default. To check a deployed site (read-only:
// pages are only loaded), set BILHARZ_COMPAT_URL, e.g.
//   BILHARZ_COMPAT_URL=https://iamglory-bilharz.hf.space npx playwright test --config playwright.compat.config.js
// Set BILHARZ_COMPAT_SCREENSHOTS=1 to save a screenshot of every page to
// docs/evidence/compatibility/.
const target = process.env.BILHARZ_COMPAT_URL

const BROWSERS = ['chromium', 'firefox', 'webkit']
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]

export default defineConfig({
  testDir: './compat',
  workers: 3,
  timeout: 90_000,
  reporter: 'list',
  globalSetup: './compat/results.js',
  use: { baseURL: target || APP_URL },
  projects: BROWSERS.flatMap((browserName) =>
    VIEWPORTS.map((viewport) => ({ name: `${browserName}-${viewport.width}`, use: { browserName, viewport } })),
  ),
  webServer: target ? undefined : webServer,
})
