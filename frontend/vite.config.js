import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development, /api goes to the backend on port 8000. If the backend isn't
// running, answer 503 like a sleeping host would, so the app shows its
// "waking up" message instead of a generic error.
const api = {
  // Override with BILHARZ_API_TARGET to point the dev server at another backend.
  target: process.env.BILHARZ_API_TARGET || 'http://localhost:8000',
  configure(proxy) {
    proxy.on('error', (err, req, res) => {
      if (typeof res.writeHead !== 'function' || res.headersSent) return
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ detail: 'The server is not reachable.' }))
    })
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': api } },
  preview: { proxy: { '/api': api } },
})
