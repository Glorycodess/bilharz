import { afterEach, describe, expect, it, vi } from 'vitest'
import { inFrame, safeNext } from './frame.js'
import { insideAFrame } from './test/fakeServer.js'

afterEach(() => vi.restoreAllMocks())

describe('inFrame', () => {
  it('is false in its own tab and true inside another page', () => {
    expect(inFrame()).toBe(false)
    insideAFrame()
    expect(inFrame()).toBe(true)
  })

  it('is true when the page around it cannot even be read', () => {
    vi.spyOn(window, 'top', 'get').mockImplementation(() => {
      throw new DOMException('Blocked a frame', 'SecurityError')
    })
    expect(inFrame()).toBe(true)
  })
})

describe('safeNext', () => {
  it('keeps a path within Bilharz', () => {
    expect(safeNext('/review/DT40')).toBe('/review/DT40')
    expect(safeNext('/samples/DT40?setting=safety')).toBe('/samples/DT40?setting=safety')
  })

  it('never sends someone on to another site after signing in', () => {
    for (const next of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '', null]) {
      expect(safeNext(next)).toBe('/queue')
    }
  })
})
