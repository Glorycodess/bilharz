import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT, PENDING, fakeServer, insideAFrame } from '../test/fakeServer.js'
import SignIn from './SignIn.jsx'
import SignUp from './SignUp.jsx'

const PASSWORD = 'correct horse battery'

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/sign-up" element={<SignUp />} />
        <Route path="/review/:id" element={<p>Review page</p>} />
        <Route path="/queue" element={<p>Queue page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => vi.restoreAllMocks())

async function fillSignIn(user, password = PASSWORD) {
  await user.type(await screen.findByLabelText('Email'), 'ada@example.org')
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('SignIn', () => {
  it('signs in and goes back to the page that asked', async () => {
    const { calls } = fakeServer({
      'GET /api/auth/me': [200, { account: null }],
      'POST /api/auth/signin': [200, ACCOUNT],
    })
    const user = userEvent.setup()
    renderAt('/sign-in?next=%2Freview%2FDT40')
    await fillSignIn(user)
    expect(await screen.findByText('Review page')).toBeInTheDocument()
    const signIn = calls.find((c) => c.path === '/api/auth/signin')
    expect(signIn.body).toEqual({ email: 'ada@example.org', password: PASSWORD })
  })

  it('shows the server’s answer and clears the password after a failed attempt', async () => {
    fakeServer({
      'GET /api/auth/me': [200, { account: null }],
      'POST /api/auth/signin': [401, { detail: 'The email or password is wrong.' }],
    })
    const user = userEvent.setup()
    renderAt('/sign-in')
    await fillSignIn(user, 'wrong password!')
    expect(await screen.findByRole('alert')).toHaveTextContent('The email or password is wrong.')
    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.org')
  })

  it('never follows a "next" link to another site', async () => {
    fakeServer({ 'GET /api/auth/me': [200, { account: null }], 'POST /api/auth/signin': [200, ACCOUNT] })
    const user = userEvent.setup()
    renderAt('/sign-in?next=%2F%2Fevil.example')
    await fillSignIn(user)
    expect(await screen.findByText('Queue page')).toBeInTheDocument()
  })

  it('keeps the password out of browser storage', async () => {
    const writes = []
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => writes.push(`${key}=${value}`))
    fakeServer({ 'GET /api/auth/me': [200, { account: null }], 'POST /api/auth/signin': [200, ACCOUNT] })
    const user = userEvent.setup()
    renderAt('/sign-in')
    await fillSignIn(user)
    await screen.findByText('Queue page')
    expect(writes.some((w) => w.includes(PASSWORD))).toBe(false)
    expect(document.cookie).not.toContain(PASSWORD)
  })

  it('inside the Hugging Face page, shows no form, only a link to a new tab', async () => {
    fakeServer({ 'GET /api/auth/me': [200, { account: null }] })
    insideAFrame()
    renderAt('/sign-in')
    expect(await screen.findByRole('link', { name: 'Open Bilharz in a new tab' })).toHaveAttribute('target', '_blank')
    expect(screen.queryByLabelText('Password')).toBeNull()
  })

  it('offers to sign out when already signed in', async () => {
    fakeServer({ 'GET /api/auth/me': [200, { account: ACCOUNT }] })
    renderAt('/sign-in')
    expect(await screen.findByText(/signed in as/)).toHaveTextContent('Ada Obi')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })
})

describe('SignUp', () => {
  it('creates a pending account and says an admin must approve it', async () => {
    const { calls } = fakeServer({ 'POST /api/auth/signup': [201, PENDING] })
    const user = userEvent.setup()
    renderAt('/sign-up')
    await user.type(screen.getByLabelText('Name'), 'Ada Obi')
    await user.type(screen.getByLabelText('Email'), 'ada@example.org')
    await user.type(screen.getByLabelText('Password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('status')).toHaveTextContent('An admin has to approve your account')
    expect(calls.find((c) => c.path === '/api/auth/signup').body).toEqual({
      name: 'Ada Obi',
      email: 'ada@example.org',
      password: PASSWORD,
    })
  })

  it('refuses a short password before sending it', async () => {
    const { calls } = fakeServer({})
    const user = userEvent.setup()
    renderAt('/sign-up')
    await user.type(screen.getByLabelText('Name'), 'Ada Obi')
    await user.type(screen.getByLabelText('Email'), 'ada@example.org')
    await user.type(screen.getByLabelText('Password'), 'short')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Use at least 12 characters')
    expect(calls).toHaveLength(0)
  })

  it('shows a taken email as the server words it', async () => {
    fakeServer({ 'POST /api/auth/signup': [409, { detail: 'An account with this email already exists. Sign in instead.' }] })
    const user = userEvent.setup()
    renderAt('/sign-up')
    await user.type(screen.getByLabelText('Name'), 'Ada Obi')
    await user.type(screen.getByLabelText('Email'), 'ada@example.org')
    await user.type(screen.getByLabelText('Password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
  })

  it('can show the password while typing it', async () => {
    fakeServer({})
    const user = userEvent.setup()
    renderAt('/sign-up')
    const field = screen.getByLabelText('Password')
    expect(field).toHaveAttribute('type', 'password')
    expect(field).toHaveAttribute('autocomplete', 'new-password')
    await user.click(screen.getByRole('button', { name: 'Show' }))
    expect(field).toHaveAttribute('type', 'text')
  })
})
