// The servers the browser tests run against: the real backend with a
// throwaway reviews database, the built site through `vite preview`, and a
// second preview whose backend is not running.
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const API_PORT = 8010
const DEAD_API_PORT = 8019 // nothing listens here
export const APP_URL = 'http://127.0.0.1:4173'
export const OFFLINE_APP_URL = 'http://127.0.0.1:4174'

const reviewsDb = join(tmpdir(), 'bilharz-e2e', 'reviews.db')
// Accounts are kept next to the database; both start empty each run.
const accountsFile = join(tmpdir(), 'bilharz-e2e', 'accounts.jsonl')

// The admin token is random and only ever given to this server and to the
// tests that make the first admin, as the project owner would. It is drawn
// once, in the runner, and the test workers inherit it through the environment.
process.env.BILHARZ_E2E_ADMIN_TOKEN ||= randomBytes(24).toString('hex')
export const ADMIN_TOKEN = process.env.BILHARZ_E2E_ADMIN_TOKEN

function preview(url, apiPort) {
  return {
    command: `npx vite preview --host 127.0.0.1 --port ${new URL(url).port} --strictPort`,
    url,
    env: { BILHARZ_API_TARGET: `http://127.0.0.1:${apiPort}` },
    reuseExistingServer: false,
  }
}

export const webServer = [
  {
    // A fresh database and no accounts each run.
    command: `rm -f "${reviewsDb}" "${accountsFile}" && exec .venv/bin/python -m uvicorn server:app --host 127.0.0.1 --port ${API_PORT}`,
    cwd: '../api',
    url: `http://127.0.0.1:${API_PORT}/api/health`,
    env: {
      BILHARZ_REVIEWS_DB: reviewsDb,
      BILHARZ_ADMIN_TOKEN: ADMIN_TOKEN,
      BILHARZ_ALLOWED_ORIGINS: APP_URL,
    },
    reuseExistingServer: false,
    timeout: 60_000,
  },
  preview(APP_URL, API_PORT),
  preview(OFFLINE_APP_URL, DEAD_API_PORT),
]
