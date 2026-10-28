import { readFileSync } from 'node:fs'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import OutcomeMark from './OutcomeMark.jsx'
import VerdictMark from './VerdictMark.jsx'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const markCss = read('./OutcomeMark.css')
const globalCss = read('../styles/global.css')

// The colour a mark class paints, resolved through the custom properties in global.css.
function colourOf(className) {
  const rule = markCss.match(new RegExp(`\\.${className}\\s*{[^}]*background:\\s*var\\((--[a-z-]+)\\)`))
  const value = rule && globalCss.match(new RegExp(`${rule[1]}:\\s*(#[0-9a-f]{6})`, 'i'))
  return value?.[1].toLowerCase()
}

function markClass(container) {
  return [...container.querySelector('.outcome__mark').classList].find((c) => c.startsWith('outcome__mark--'))
}

const GREEN = '#15803d'
const RED = '#b91c1c'
const BLUE = '#2563eb'

describe('OutcomeMark', () => {
  it.each([
    ['negative', 'Negative', GREEN],
    ['referred', 'Referred', BLUE],
    ['positive', 'Positive', RED],
  ])('shows %s as a word and a %s dot', (kind, word, colour) => {
    const { container } = render(<OutcomeMark kind={kind} />)
    expect(screen.getByText(word)).toBeInTheDocument()
    expect(colourOf(markClass(container))).toBe(colour)
  })

  it('keeps the dot when the text is replaced, and hides the dot from screen readers', () => {
    const { container } = render(<OutcomeMark kind="referred">Referred to a technician</OutcomeMark>)
    expect(screen.getByText('Referred to a technician')).toBeInTheDocument()
    expect(container.querySelector('.outcome__mark')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('VerdictMark', () => {
  it.each([
    ['infected', 'Infected', RED],
    ['healthy', 'Healthy', GREEN],
  ])('shows %s as a word and a %s dot', (verdict, word, colour) => {
    const { container } = render(<VerdictMark verdict={verdict} />)
    expect(screen.getByText(word)).toBeInTheDocument()
    expect(colourOf(markClass(container))).toBe(colour)
  })
})
