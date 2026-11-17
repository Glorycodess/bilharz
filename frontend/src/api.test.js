import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  WAKING_MESSAGE,
  claimAdmin,
  countWaiting,
  dataVersion,
  downloadReviewsCsv,
  getConfig,
  getMe,
  getQueue,
  getReviews,
  getSample,
  isReviewed,
  isWaiting,
  postReview,
  signIn,
} from './api.js'

function reply(status, body) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

const SAMPLE = {
  id: 'DT40',
  source: 'stored',
  setting: 'safety',
  tile_threshold: 0.95,
  confident_tiles: 4,
  decision: 'referred',
  tiles_scored: 1404,
  highest_score: 0.9993,
  highest_tile: { image: '0003_0004', tile: 7 },
  top_tiles: [
    { rank: 1, score: 0.9993, image: '0003_0004', tile: 7, url: '/api/tiles/DT40/1.jpg', confident: true },
  ],
  review: {
    id: 3,
    verdict: 'infected',
    created_at: '2026-10-26T15:07:00+00:00',
    note: 'One egg, tile 7',
    tester_code: 'T4',
    reviewer_name: 'Ada Obi',
    details_hidden: false,
  },
  review_count: 2,
}

let fetchMock

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

describe('snake_case to camelCase', () => {
  it('maps a stored sample', async () => {
    fetchMock.mockReturnValue(reply(200, SAMPLE))
    const sample = await getSample('DT40')
    expect(sample).toEqual({
      id: 'DT40',
      source: 'stored',
      setting: 'safety',
      tileThreshold: 0.95,
      confidentTiles: 4,
      decision: 'referred',
      tilesScored: 1404,
      highestScore: 0.9993,
      highestTile: { image: '0003_0004', tile: 7 },
      topTiles: [
        { rank: 1, score: 0.9993, image: '0003_0004', tile: 7, confident: true, imageUrl: '/api/tiles/DT40/1.jpg' },
      ],
      seconds: null,
      review: {
        id: 3,
        verdict: 'infected',
        createdAt: '2026-10-26T15:07:00+00:00',
        note: 'One egg, tile 7',
        testerCode: 'T4',
        reviewerName: 'Ada Obi',
        supersedes: null,
        detailsHidden: false,
      },
      reviewCount: 2,
    })
  })

  it('fills in fields the server left out', async () => {
    const { review, review_count, ...bare } = SAMPLE
    fetchMock.mockReturnValue(reply(200, { ...bare, review: { verdict: 'healthy', created_at: 'x' } }))
    const sample = await getSample('DT40')
    expect(sample.reviewCount).toBe(0)
    expect(sample.seconds).toBeNull()
    expect(sample.review).toEqual({
      id: null,
      verdict: 'healthy',
      createdAt: 'x',
      note: null,
      testerCode: null,
      reviewerName: null,
      supersedes: null,
      detailsHidden: false,
    })
    expect(review).toBeDefined()
    expect(review_count).toBe(2)
  })

  it('maps the queue, with no review as null', async () => {
    fetchMock.mockReturnValue(
      reply(200, {
        setting: 'safety',
        samples: [
          { id: 'DT01', confident_tiles: 0, decision: 'negative', review: null },
          { id: 'DT40', confident_tiles: 4, decision: 'referred', review: { verdict: 'infected', created_at: 't' } },
        ],
      }),
    )
    const queue = await getQueue()
    expect(queue[0]).toEqual({ id: 'DT01', confidentTiles: 0, decision: 'negative', review: null })
    expect(queue[1].review).toMatchObject({ verdict: 'infected', createdAt: 't' })
  })

  it('maps the config and picks the default setting', async () => {
    fetchMock.mockReturnValue(
      reply(200, {
        default: 'safety',
        settings: {
          safety: { tile_threshold: 0.95, clear_below: 1, flag_above: 35, rule: '' },
          efficiency: { tile_threshold: 0.99, clear_below: 1, flag_above: 12, rule: '' },
        },
      }),
    )
    const config = await getConfig()
    expect(config).toMatchObject({ key: 'safety', label: 'Safety', setting: 'Safety', tileThreshold: 0.95, flagAbove: 35 })
    expect(config.settings.efficiency).toEqual({
      key: 'efficiency',
      label: 'Efficiency',
      tileThreshold: 0.99,
      clearBelow: 1,
      flagAbove: 12,
    })
  })

  it('maps review list items', async () => {
    fetchMock.mockReturnValue(
      reply(200, [
        {
          id: 7,
          sample_id: 'DT40',
          verdict: 'healthy',
          note: null,
          tester_code: null,
          created_at: 't',
          supersedes: 3,
          decision: 'referred',
          version_count: 2,
        },
      ]),
    )
    const [item] = await getReviews('all')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/reviews?view=all')
    expect(item).toMatchObject({ id: 7, sampleId: 'DT40', supersedes: 3, decision: 'referred', versionCount: 2 })
  })
})

describe('waiting and reviewed', () => {
  const referred = { decision: 'referred', review: null }
  const reviewed = { decision: 'referred', review: { verdict: 'healthy' } }
  const decided = { decision: 'negative', review: null }

  it('counts a referred sample as waiting until it has a review', () => {
    expect(isWaiting(referred)).toBe(true)
    expect(isWaiting(reviewed)).toBe(false)
    expect(isWaiting(decided)).toBe(false)
    expect(countWaiting([referred, reviewed, decided, referred])).toBe(2)
  })

  it('treats a missing review like no review', () => {
    expect(isReviewed({ decision: 'referred' })).toBe(false)
    expect(isWaiting({ decision: 'referred' })).toBe(true)
    expect(isReviewed(reviewed)).toBe(true)
  })
})

describe('errors', () => {
  it('returns null for an unknown sample', async () => {
    fetchMock.mockReturnValue(reply(404, { detail: 'Sample not found.' }))
    expect(await getSample('DT99')).toBeNull()
  })

  it.each([502, 503, 504])('reports %i as a waking server', async (status) => {
    fetchMock.mockReturnValue(reply(status, { detail: 'whatever the proxy says' }))
    const error = await getQueue().catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.unreachable).toBe(true)
    expect(error.message).toBe(WAKING_MESSAGE)
  })

  it("passes on the backend's message when accounts can't be saved (500)", async () => {
    fetchMock.mockReturnValue(reply(500, { detail: "Accounts can't be saved on this server right now." }))
    const error = await getQueue().catch((e) => e)
    expect(error.unreachable).toBe(false)
    expect(error.message).toBe("Accounts can't be saved on this server right now.")
  })

  it('reports a network failure as a waking server', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(getQueue()).rejects.toMatchObject({ unreachable: true, message: WAKING_MESSAGE })
  })

  it("passes on the server's own message", async () => {
    fetchMock.mockReturnValue(reply(409, { detail: 'This review has already been changed.' }))
    await expect(postReview('DT40', { verdict: 'healthy', note: '' })).rejects.toMatchObject({
      status: 409,
      message: 'This review has already been changed.',
    })
  })

  it('falls back to a plain message without one', async () => {
    fetchMock.mockReturnValue(reply(500, null))
    await expect(getQueue()).rejects.toMatchObject({ status: 500, message: 'Something went wrong. Please try again.' })
  })
})

describe('requests', () => {
  it('shares one request between identical GETs in flight', async () => {
    fetchMock.mockImplementation(() => reply(200, { setting: 'safety', samples: [] }))
    await Promise.all([getQueue(), getQueue()])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await getQueue()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('posts a review as JSON, with an empty note sent as null', async () => {
    fetchMock.mockReturnValue(reply(201, {}))
    await postReview('DT40', { verdict: 'infected', note: '', supersedes: 3 })
    const [path, options] = fetchMock.mock.calls[0]
    expect(path).toBe('/api/reviews/DT40')
    expect(options.method).toBe('POST')
    expect(options.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(options.body)).toEqual({ verdict: 'infected', note: null, supersedes: 3 })
  })

  it('explains a refused export token', async () => {
    fetchMock.mockReturnValue(reply(403, { detail: 'Not allowed.' }))
    await expect(downloadReviewsCsv('wrong')).rejects.toMatchObject({ status: 403, message: "That token isn't valid." })
    fetchMock.mockReturnValue(reply(403, { detail: 'This is turned off on this server: no admin token is set.' }))
    await expect(downloadReviewsCsv('any')).rejects.toMatchObject({
      message: 'Export is turned off on this server: no admin token is set.',
    })
    expect(fetchMock.mock.calls[0][1].headers['X-Admin-Token']).toBe('wrong')
  })
})

describe('accounts', () => {
  it('maps the signed-in account and what it may do', async () => {
    const base = { id: 2, name: 'Ada Obi', email: 'ada@example.org', role: 'reviewer' }
    fetchMock.mockReturnValueOnce(reply(200, { account: { ...base, status: 'pending' } }))
    expect(await getMe()).toMatchObject({ name: 'Ada Obi', canReview: false, isAdmin: false })
    fetchMock.mockReturnValueOnce(reply(200, { account: { ...base, status: 'approved' } }))
    expect(await getMe()).toMatchObject({ canReview: true, isAdmin: false })
    fetchMock.mockReturnValueOnce(reply(200, { account: { ...base, role: 'admin', status: 'approved' } }))
    expect(await getMe()).toMatchObject({ canReview: true, isAdmin: true })
    fetchMock.mockReturnValueOnce(reply(200, { account: null }))
    expect(await getMe()).toBeNull()
  })

  it('signs in with a JSON body and reloads every view', async () => {
    fetchMock.mockReturnValue(reply(200, { id: 2, name: 'Ada', email: 'a@example.org', role: 'reviewer', status: 'approved' }))
    const before = dataVersion()
    await signIn({ email: 'a@example.org', password: 'correct horse battery' })
    const [path, options] = fetchMock.mock.calls[0]
    expect(path).toBe('/api/auth/signin')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({ email: 'a@example.org', password: 'correct horse battery' })
    expect(dataVersion()).toBeGreaterThan(before)
  })

  it('sends the admin token only with the request that needs it', async () => {
    fetchMock.mockReturnValue(reply(200, { id: 2, name: 'Ada', email: 'a@example.org', role: 'admin', status: 'approved' }))
    await claimAdmin('the-token')
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ 'X-Admin-Token': 'the-token' })
  })

  it('exports as a signed-in admin without any token', async () => {
    fetchMock.mockResolvedValue(new Response('review_id\n', { status: 200 }))
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:csv'), revokeObjectURL: vi.fn() }))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await downloadReviewsCsv()
    expect(fetchMock).toHaveBeenCalledWith('/api/reviews.csv', { headers: {} })
  })

  it('when the session has ended, asks the server again who is signed in, once', async () => {
    fetchMock.mockReturnValueOnce(reply(200, { account: { id: 2, name: 'Ada', email: 'a@example.org', role: 'reviewer', status: 'approved' } }))
    await getMe()
    fetchMock.mockReturnValue(reply(401, { detail: 'Sign in as a reviewer to do this.' }))
    const before = dataVersion()
    await expect(getReviews()).rejects.toMatchObject({ status: 401 })
    expect(dataVersion()).toBe(before + 1)
    // Already known to be signed out: no second refresh, so no loop.
    await expect(getReviews()).rejects.toMatchObject({ status: 401 })
    expect(dataVersion()).toBe(before + 1)
  })
})
