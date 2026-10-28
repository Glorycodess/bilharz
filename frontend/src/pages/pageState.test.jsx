import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WAKING_MESSAGE } from '../api.js'
import Queue from './Queue.jsx'

const CONFIG = {
  default: 'safety',
  settings: { safety: { tile_threshold: 0.95, clear_below: 1, flag_above: 35, rule: '' } },
  review_code_required: false,
}

const QUEUE = {
  setting: 'safety',
  samples: [
    { id: 'DT02', confident_tiles: 0, decision: 'negative', review: null },
    { id: 'DT29', confident_tiles: 64, decision: 'positive', review: null },
    { id: 'DT40', confident_tiles: 4, decision: 'referred', review: null },
  ],
}

function json(status, body) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

// Answers each endpoint from `responses` ({ '/api/samples': () => ... }).
function serve(responses) {
  vi.stubGlobal(
    'fetch',
    vi.fn((path) => responses[path]?.() ?? json(404, { detail: 'Not Found' })),
  )
}

const working = { '/api/samples': () => json(200, QUEUE), '/api/config': () => json(200, CONFIG) }

function renderQueue() {
  return render(
    <MemoryRouter>
      <Queue />
    </MemoryRouter>,
  )
}

describe('page states', () => {
  beforeEach(() => serve(working))
  afterEach(() => vi.useRealTimers())

  it('shows a loading state, then the data', async () => {
    renderQueue()
    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.getByText('1 waiting for a technician')).toBeInTheDocument()
  })

  it('says the server is waking up, and tries again by itself', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    serve({ '/api/samples': () => json(503, null), '/api/config': () => json(503, null) })
    renderQueue()
    await act(() => vi.advanceTimersByTimeAsync(0))

    expect(screen.getByRole('alert')).toHaveTextContent(WAKING_MESSAGE)
    expect(screen.getByText('Trying again automatically in a few seconds.')).toBeInTheDocument()

    serve(working)
    await act(() => vi.advanceTimersByTimeAsync(10000))
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.queryByText(WAKING_MESSAGE)).toBeNull()
  })

  it('shows other errors with a Try again button that reloads', async () => {
    serve({ '/api/samples': () => json(500, { detail: 'Internal server error.' }), '/api/config': working['/api/config'] })
    const user = userEvent.setup()
    renderQueue()

    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error.')
    expect(screen.queryByText('Trying again automatically in a few seconds.')).toBeNull()

    serve(working)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })
})
