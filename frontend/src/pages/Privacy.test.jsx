import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Privacy from './Privacy.jsx'

const HEADINGS = [
  'What Bilharz receives',
  'How images are processed',
  'What Bilharz stores',
  'Signing in and your browser',
  'IP addresses',
  'Who can see the data',
  'How decisions are made',
  'Limits of the tool',
  'Retention',
  'Third-party hosting',
  'Contact',
]

describe('Privacy', () => {
  it('shows the title, summary and the eleven sections in order', () => {
    render(<Privacy />)
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeInTheDocument()
    expect(screen.getByText('What Bilharz receives, what it keeps, and how it decides.')).toBeInTheDocument()
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual(HEADINGS)
    expect(screen.getAllByRole('listitem')).toHaveLength(11)
    expect(screen.getByRole('link', { name: 'g.paul@alustudent.com' })).toHaveAttribute(
      'href',
      'mailto:g.paul@alustudent.com',
    )
    expect(screen.getByRole('link', { name: 'https://huggingface.co/privacy' })).toHaveAttribute(
      'href',
      'https://huggingface.co/privacy',
    )
  })
})
