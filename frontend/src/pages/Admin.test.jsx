import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADMIN, PENDING, fakeServer } from '../test/fakeServer.js'
import Admin from './Admin.jsx'

const listed = (a, extra = {}) => ({
  ...a,
  created_at: '2026-11-17T09:00:00+00:00',
  approved_at: null,
  reset_link_active: false,
  ...extra,
})

function renderAdmin() {
  return render(
    <MemoryRouter>
      <Admin />
    </MemoryRouter>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('Admin', () => {
  it('asks a visitor to sign in, and shows no accounts', async () => {
    const { calls } = fakeServer({ 'GET /api/auth/me': [200, { account: null }] })
    renderAdmin()
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in?next=%2Fadmin')
    expect(calls.some((c) => c.path === '/api/admin/accounts')).toBe(false)
  })

  it('offers a non-admin only the admin token form, and does not keep the token', async () => {
    const writes = []
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => writes.push(`${key}=${value}`))
    const { calls } = fakeServer({
      'GET /api/auth/me': [200, { account: PENDING }],
      'POST /api/admin/claim': [403, { detail: "That admin token isn't valid." }],
    })
    const user = userEvent.setup()
    renderAdmin()
    await user.type(await screen.findByLabelText('Admin token'), 'a-guess')
    await user.click(screen.getByRole('button', { name: 'Make me an admin' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("That admin token isn't valid.")
    expect(screen.getByLabelText('Admin token')).toHaveValue('')
    expect(calls.find((c) => c.path === '/api/admin/claim').headers).toMatchObject({ 'X-Admin-Token': 'a-guess' })
    expect(calls.some((c) => c.path === '/api/admin/accounts')).toBe(false)
    expect(writes.some((w) => w.includes('a-guess'))).toBe(false)
  })

  it('lists accounts for an admin and approves a pending one', async () => {
    let pending = listed(PENDING)
    const { calls } = fakeServer({
      'GET /api/auth/me': [200, { account: ADMIN }],
      'GET /api/admin/accounts': () => [200, [listed(ADMIN), pending]],
      'POST /api/admin/accounts/2/approve': () => {
        pending = { ...pending, status: 'approved' }
        return [200, pending]
      },
    })
    const user = userEvent.setup()
    renderAdmin()
    expect(await screen.findByText('2 accounts · 1 waiting for approval')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Approve Ada Obi' }))
    expect(await screen.findByText('2 accounts · 0 waiting for approval')).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/api/admin/accounts/2/approve'])
  })

  it('never offers an admin to disable or demote their own account', async () => {
    fakeServer({
      'GET /api/auth/me': [200, { account: ADMIN }],
      'GET /api/admin/accounts': [200, [listed(ADMIN), listed({ ...PENDING, status: 'approved' })]],
    })
    renderAdmin()
    const own = (await screen.findByText('Admin Person')).closest('tr')
    expect(within(own).queryByRole('button', { name: /Disable/ })).toBeNull()
    expect(within(own).queryByRole('button', { name: /Make .* a reviewer/ })).toBeNull()
    const other = screen.getByText('Ada Obi').closest('tr')
    expect(within(other).getByRole('button', { name: 'Disable Ada Obi' })).toBeInTheDocument()
    expect(within(other).getByRole('button', { name: 'Make Ada Obi an admin' })).toBeInTheDocument()
  })

  it('shows a reset link once, to hand over, and forgets it when done', async () => {
    const url = 'https://iamglory-bilharz.hf.space/reset-password#token=abc'
    fakeServer({
      'GET /api/auth/me': [200, { account: ADMIN }],
      'GET /api/admin/accounts': [200, [listed(ADMIN), listed({ ...PENDING, status: 'approved' })]],
      'POST /api/admin/accounts/2/reset-link': [200, { url, expires_at: '2026-11-17T10:00:00+00:00' }],
    })
    const user = userEvent.setup()
    renderAdmin()
    await user.click(await screen.findByRole('button', { name: 'Make a reset link for Ada Obi' }))
    expect(await screen.findByRole('textbox', { name: 'Reset link for Ada Obi' })).toHaveValue(url)
    expect(screen.getByText(/anyone who has it can set the password/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByDisplayValue(url)).toBeNull()
  })

  it('shows the server’s refusal next to the account', async () => {
    fakeServer({
      'GET /api/auth/me': [200, { account: ADMIN }],
      'GET /api/admin/accounts': [200, [listed(ADMIN), listed({ ...PENDING, status: 'approved' })]],
      'POST /api/admin/accounts/2/disable': [500, { detail: "Accounts can't be saved on this server right now." }],
    })
    const user = userEvent.setup()
    renderAdmin()
    await user.click(await screen.findByRole('button', { name: 'Disable Ada Obi' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Ada Obi: Accounts can't be saved")
  })
})
