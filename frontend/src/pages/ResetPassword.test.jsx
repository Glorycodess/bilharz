import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeServer } from '../test/fakeServer.js'
import ResetPassword from './ResetPassword.jsx'

const TOKEN = 'Abc_123-xyz'

function openLink(hash) {
  window.history.replaceState(null, '', `/reset-password${hash}`)
  return render(
    <MemoryRouter>
      <ResetPassword />
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('ResetPassword', () => {
  it('takes the token from the link and removes it from the address bar at once', async () => {
    const { calls } = fakeServer({ 'POST /api/auth/reset': [204, null] })
    const user = userEvent.setup()
    openLink(`#token=${TOKEN}`)
    expect(window.location.hash).toBe('')
    expect(window.location.href).not.toContain(TOKEN)

    await user.type(screen.getByLabelText('New password'), 'a brand new passphrase')
    await user.click(screen.getByRole('button', { name: 'Set password' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Your password is changed')
    expect(calls.find((c) => c.path === '/api/auth/reset').body).toEqual({
      token: TOKEN,
      password: 'a brand new passphrase',
    })
  })

  it('says so when the link is used up or expired', async () => {
    fakeServer({
      'POST /api/auth/reset': [400, { detail: 'This reset link is not valid or has expired. Ask an admin for a new one.' }],
    })
    const user = userEvent.setup()
    openLink(`#token=${TOKEN}`)
    await user.type(screen.getByLabelText('New password'), 'a brand new passphrase')
    await user.click(screen.getByRole('button', { name: 'Set password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not valid or has expired')
  })

  it('asks for the whole link when there is no token', () => {
    fakeServer({})
    openLink('')
    expect(screen.getByRole('alert')).toHaveTextContent('needs the reset link')
    expect(screen.queryByLabelText('New password')).toBeNull()
  })
})
