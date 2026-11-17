import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT, PENDING, fakeServer, insideAFrame } from '../test/fakeServer.js'
import ReviewerGate from './ReviewerGate.jsx'

function renderGate() {
  return render(
    <MemoryRouter initialEntries={['/review/DT40']}>
      <ReviewerGate purpose="record reviews">
        <p>The review form</p>
      </ReviewerGate>
    </MemoryRouter>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('ReviewerGate', () => {
  it('asks someone who is not signed in to sign in, and comes back here after', async () => {
    fakeServer({ 'GET /api/auth/me': [200, { account: null }] })
    renderGate()
    expect(await screen.findByRole('heading', { name: 'Sign in to record reviews' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in?next=%2Freview%2FDT40')
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/sign-up?next=%2Freview%2FDT40')
    expect(screen.queryByText('The review form')).toBeNull()
  })

  it('tells a pending account that an admin has to approve it', async () => {
    fakeServer({ 'GET /api/auth/me': [200, { account: PENDING }] })
    renderGate()
    expect(await screen.findByRole('heading', { name: 'Waiting for approval' })).toBeInTheDocument()
    expect(screen.getByText(/signed in as Ada Obi/)).toBeInTheDocument()
    expect(screen.queryByText('The review form')).toBeNull()
  })

  it('shows the page to an approved reviewer', async () => {
    fakeServer({ 'GET /api/auth/me': [200, { account: ACCOUNT }] })
    renderGate()
    expect(await screen.findByText('The review form')).toBeInTheDocument()
  })

  it('inside the Hugging Face page, offers Bilharz in a new tab instead', async () => {
    fakeServer({ 'GET /api/auth/me': [200, { account: null }] })
    insideAFrame()
    renderGate()
    const link = await screen.findByRole('link', { name: 'Open Bilharz in a new tab' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link.getAttribute('href')).toBe(`${window.location.origin}/sign-in?next=%2Freview%2FDT40`)
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull()
  })
})
