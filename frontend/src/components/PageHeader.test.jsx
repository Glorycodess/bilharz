import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import PageHeader from './PageHeader.jsx'

describe('PageHeader', () => {
  it('shows the breadcrumb, title, summary and actions', () => {
    render(
      <PageHeader
        breadcrumb={<nav aria-label="Breadcrumb">Queue / DT40</nav>}
        title="Review DT40"
        summary="Referred · 4 confident tiles"
        actions={<button type="button">Back</button>}
      />,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Review DT40' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
    expect(screen.getByText('Referred · 4 confident tiles')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('leaves out the summary and actions when there are none', () => {
    const { container } = render(<PageHeader title="Queue" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Queue' })).toBeInTheDocument()
    expect(container.querySelector('.page-header__summary')).toBeNull()
    expect(container.querySelector('.page-header__actions')).toBeNull()
  })
})
