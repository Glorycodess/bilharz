import { beforeEach, describe, expect, it, vi } from 'vitest'

const CONFIG = {
  default: 'safety',
  settings: {
    safety: { tile_threshold: 0.95, clear_below: 1, flag_above: 35, rule: '' },
    efficiency: { tile_threshold: 0.99, clear_below: 1, flag_above: 12, rule: '' },
  },
  review_code_required: false,
}

const SAMPLE = {
  id: 'DT40',
  source: 'stored',
  setting: 'efficiency',
  tile_threshold: 0.99,
  confident_tiles: 1,
  decision: 'referred',
  tiles_scored: 1404,
  highest_score: 0.9993,
  highest_tile: { image: '0003_0004', tile: 7 },
  top_tiles: [],
  review: null,
  review_count: 0,
}

function reply(body) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}

let fetchMock

// api.js reads the stored choice when it loads, so each test loads it afresh.
async function loadApi() {
  vi.resetModules()
  return import('./api.js')
}

function paths() {
  return fetchMock.mock.calls.map(([path]) => path)
}

beforeEach(() => {
  localStorage.clear()
  fetchMock = vi.fn((path) => {
    if (path === '/api/config') return reply(CONFIG)
    if (path.startsWith('/api/samples/')) return reply(SAMPLE)
    if (path.startsWith('/api/samples')) return reply({ setting: 'safety', samples: [] })
    return reply([])
  })
  vi.stubGlobal('fetch', fetchMock)
})

describe('decision setting', () => {
  it("uses the server's default until one is chosen", async () => {
    const api = await loadApi()
    expect(await api.getConfig()).toMatchObject({ key: 'safety', setting: 'Safety', defaultKey: 'safety' })
    await api.getQueue()
    expect(paths()).toContain('/api/samples')
  })

  it('sends the chosen setting with the queue, a sample and its config, and stores it', async () => {
    const api = await loadApi()
    const listener = vi.fn()
    api.subscribe(listener)
    api.chooseSetting('efficiency')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('bilharz.setting')).toBe('efficiency')

    expect(await api.getConfig()).toMatchObject({
      key: 'efficiency',
      setting: 'Efficiency',
      tileThreshold: 0.99,
      flagAbove: 12,
      defaultKey: 'safety',
    })
    await api.getQueue()
    await api.getSample('DT40')
    expect(paths()).toContain('/api/samples?setting=efficiency')
    expect(paths()).toContain('/api/samples/DT40?setting=efficiency')
  })

  it('keeps the choice after a reload', async () => {
    localStorage.setItem('bilharz.setting', 'efficiency')
    const api = await loadApi()
    await api.getQueue()
    expect(paths()).toContain('/api/samples?setting=efficiency')
  })

  it("drops a stored setting the server doesn't know", async () => {
    localStorage.setItem('bilharz.setting', 'turbo')
    const api = await loadApi()
    expect((await api.getConfig()).key).toBe('safety')
    await api.getQueue()
    expect(paths()).toContain('/api/samples')
    expect(paths().some((p) => p.includes('turbo'))).toBe(false)
    expect(localStorage.getItem('bilharz.setting')).toBeNull()
  })

  it('still works, for this page load, when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    const api = await loadApi()
    api.chooseSetting('efficiency')
    await api.getQueue()
    expect(paths()).toContain('/api/samples?setting=efficiency')
  })

  it('does not change review requests', async () => {
    const api = await loadApi()
    api.chooseSetting('efficiency')
    await api.getReviews()
    expect(paths()).toContain('/api/reviews?view=current')
  })

  it('sends the chosen setting with an upload', async () => {
    const opened = []
    class FakeXhr {
      upload = {}
      open(method, url) {
        opened.push([method, url])
      }
      setRequestHeader() {}
      send() {
        this.status = 200
        this.responseText = JSON.stringify({ ...SAMPLE, source: 'upload', seconds: 4.2 })
        this.onload()
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    const api = await loadApi()
    api.chooseSetting('efficiency')
    const result = await api.analyseUpload([new File(['x'], 'a.jpg')])
    expect(opened).toEqual([['POST', '/api/analyse?setting=efficiency']])
    expect(result.setting).toBe('efficiency')
  })
})
