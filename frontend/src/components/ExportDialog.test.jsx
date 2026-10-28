import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ExportDialog from './ExportDialog.jsx'

const TOKEN = 'a-test-token'

let fetchMock
let writes

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  writes = []
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => writes.push(`storage ${key}=${value}`))
  const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
  vi.spyOn(document, 'cookie', 'set').mockImplementation((value) => {
    writes.push(`cookie ${value}`)
    cookie.set.call(document, value)
  })
})

async function submitToken(user) {
  await user.click(screen.getByRole('button', { name: 'Export CSV' }))
  await user.type(screen.getByLabelText('Admin token'), TOKEN)
  await user.click(screen.getByRole('button', { name: 'Download' }))
}

function storedAnywhere() {
  const stored = [...writes, document.cookie, JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage })]
  return stored.some((s) => s.includes(TOKEN))
}

describe('ExportDialog', () => {
  it('clears the token and shows the error after a refused attempt', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ detail: 'Not allowed.' }), { status: 403 }))
    const user = userEvent.setup()
    render(<ExportDialog />)
    await submitToken(user)

    expect(await screen.findByRole('alert')).toHaveTextContent("That token isn't valid.")
    expect(screen.getByLabelText('Admin token')).toHaveValue('')
    expect(fetchMock).toHaveBeenCalledWith('/api/reviews.csv', { headers: { 'X-Admin-Token': TOKEN } })
    expect(storedAnywhere()).toBe(false)
  })

  it('clears the token and closes after a download', async () => {
    fetchMock.mockResolvedValue(new Response('review_id\n', { status: 200 }))
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:csv'), revokeObjectURL: vi.fn() }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const user = userEvent.setup()
    const { container } = render(<ExportDialog />)
    await submitToken(user)

    await waitFor(() => expect(container.querySelector('dialog').open).toBe(false))
    expect(click).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Admin token', { hidden: true })).toHaveValue('')
    expect(storedAnywhere()).toBe(false)
  })

  it('clears a typed token when cancelled', async () => {
    const user = userEvent.setup()
    render(<ExportDialog />)
    await user.click(screen.getByRole('button', { name: 'Export CSV' }))
    await user.type(screen.getByLabelText('Admin token'), TOKEN)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByLabelText('Admin token', { hidden: true })).toHaveValue('')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
