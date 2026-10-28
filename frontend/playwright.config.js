import { defineConfig, devices } from '@playwright/test'
import { APP_URL, webServer } from './e2e/servers.js'

// End-to-end tests: `npm run test:e2e` builds the site, then runs these
// against it and the local backend (see e2e/servers.js). They share one
// reviews database and depend on each other's order, so they run serially.
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 60_000,
  reporter: 'list',
  use: { baseURL: APP_URL },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer,
})
