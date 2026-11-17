import { vi } from 'vitest'

// A stand-in for the backend: `routes` maps "METHOD /path" (the path without
// its query string) to a status and body, or to a function of the request.
// Every request is recorded in `calls`.
export function fakeServer(routes) {
  const calls = []
  const fetchMock = vi.fn(async (url, options = {}) => {
    const method = options.method ?? 'GET'
    const path = String(url).split('?')[0]
    const body = options.body ? JSON.parse(options.body) : undefined
    calls.push({ method, path, url: String(url), headers: options.headers ?? {}, body })
    let answer = routes[`${method} ${path}`]
    if (typeof answer === 'function') answer = answer({ body, headers: options.headers ?? {} })
    if (!answer) return new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 })
    const [status, data] = answer
    return new Response(status === 204 ? null : JSON.stringify(data), { status })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

export const ACCOUNT = { id: 2, name: 'Ada Obi', email: 'ada@example.org', role: 'reviewer', status: 'approved' }
export const PENDING = { ...ACCOUNT, status: 'pending' }
export const ADMIN = { id: 1, name: 'Admin Person', email: 'admin@example.org', role: 'admin', status: 'approved' }

// Pretend Bilharz is shown inside another page (the Space on huggingface.co).
export function insideAFrame() {
  return vi.spyOn(window, 'top', 'get').mockReturnValue({})
}
