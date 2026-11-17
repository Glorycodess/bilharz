import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// guide.js reads storage when it loads, so each test loads it (and the
// components that use it) afresh.
async function load() {
  vi.resetModules()
  const guide = await import('../guide.js')
  const { default: FirstVisitGuide } = await import('./FirstVisitGuide.jsx')
  const { default: Footer } = await import('./Footer.jsx')
  function Page() {
    return (
      <MemoryRouter>
        <FirstVisitGuide />
        <Footer />
      </MemoryRouter>
    )
  }
  return { guide, Page }
}

const hideButton = () => screen.queryByRole('button', { name: 'Got it, hide this' })
const showButton = () => screen.queryByRole('button', { name: 'Show the first-time guide' })

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('FirstVisitGuide', () => {
  it('is shown to a first-time visitor, with the three outcomes and how reviewing works', async () => {
    const { Page } = await load()
    render(<Page />)
    expect(screen.getByRole('heading', { level: 2, name: 'New to Bilharz?' })).toBeInTheDocument()
    for (const word of ['Negative', 'Referred', 'Positive']) expect(screen.getByText(word)).toBeInTheDocument()
    expect(screen.getByText('How reviewing works.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Queue' })).toHaveAttribute('href', '/queue')
    expect(showButton()).toBeNull()
  })

  it('stays hidden once dismissed, also after a reload', async () => {
    const user = userEvent.setup()
    let { guide, Page } = await load()
    const { unmount } = render(<Page />)
    await user.click(hideButton())
    expect(screen.queryByRole('heading', { name: 'New to Bilharz?' })).toBeNull()
    expect(localStorage.getItem(guide.GUIDE_KEY)).toBe('1')
    unmount()
    ;({ Page } = await load())
    render(<Page />)
    expect(screen.queryByRole('heading', { name: 'New to Bilharz?' })).toBeNull()
    expect(showButton()).toBeInTheDocument()
  })

  it('comes back from the footer link', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const { guide, Page } = await load()
    render(<Page />)
    await user.click(hideButton())
    await user.click(showButton())
    expect(screen.getByRole('heading', { name: 'New to Bilharz?' })).toBeInTheDocument()
    expect(localStorage.getItem(guide.GUIDE_KEY)).toBeNull()
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('still works, in memory, where storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { guide, Page } = await load()
    render(<Page />)
    expect(hideButton()).toBeInTheDocument()
    act(() => guide.hideGuide())
    expect(hideButton()).toBeNull()
    expect(showButton()).toBeInTheDocument()
  })
})
