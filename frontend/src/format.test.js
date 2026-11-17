import { describe, expect, it } from 'vitest'
import { decisionSentence } from './format.js'

const SAFETY = { label: 'Safety', clearBelow: 1, flagAbove: 35 }
const EFFICIENCY = { label: 'Efficiency', clearBelow: 1, flagAbove: 12 }

describe('decisionSentence', () => {
  it('explains a negative with no tile', () => {
    expect(decisionSentence('negative', 0, SAFETY)).toBe(
      'Negative: no tile looks like an egg, so the sample was cleared without review.',
    )
  })

  it('explains a referral with the cut-off of the setting that made it', () => {
    expect(decisionSentence('referred', 4, SAFETY)).toBe(
      'Referred: 4 tiles look like eggs, too many to clear and too few to confirm ' +
        '(confirming takes more than 35 under the Safety setting), so a technician should review it.',
    )
    expect(decisionSentence('referred', 4, EFFICIENCY)).toContain('more than 12 under the Efficiency setting')
  })

  it('uses the singular for one tile', () => {
    expect(decisionSentence('referred', 1, EFFICIENCY)).toMatch(/^Referred: 1 tile looks like an egg, /)
  })

  it('explains a positive with the cut-off it passed', () => {
    expect(decisionSentence('positive', 1204, SAFETY)).toBe(
      'Positive: 1,204 tiles look like eggs, more than the 35 it takes to confirm under the Safety setting, ' +
        'so the sample was confirmed without review.',
    )
  })

  it('names the lower cut-off when a setting clears more than zero tiles', () => {
    expect(decisionSentence('negative', 2, { label: 'Custom', clearBelow: 3, flagAbove: 20 })).toBe(
      'Negative: 2 tiles look like eggs, fewer than the 3 it takes to refer a sample under the Custom setting, ' +
        'so the sample was cleared without review.',
    )
  })

  it('always says "tiles", never "regions"', () => {
    for (const [decision, n] of [
      ['negative', 0],
      ['referred', 5],
      ['positive', 40],
    ]) {
      expect(decisionSentence(decision, n, SAFETY)).not.toMatch(/region/i)
    }
  })
})
