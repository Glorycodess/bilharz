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
    // A fresh database each run. The admin token is random and only ever
    // passed to this server, so the export test can only send a wrong one.
    command: `rm -f "${reviewsDb}" && exec .venv/bin/python -m uvicorn server:app --host 127.0.0.1 --port ${API_PORT}`,
    cwd: '../api',
    url: `http://127.0.0.1:${API_PORT}/api/health`,
    env: {
      BILHARZ_REVIEWS_DB: reviewsDb,
      BILHARZ_ADMIN_TOKEN: randomBytes(24).toString('hex'),
      BILHARZ_REVIEW_CODE: '',
      BILHARZ_ALLOWED_ORIGINS: APP_URL,
    },
    reuseExistingServer: false,
    timeout: 60_000,
  },
  preview(APP_URL, API_PORT),
  preview(OFFLINE_APP_URL, DEAD_API_PORT),
]
