// Repeated 5-fold cross-validation over 65 patients. Efficiency is the main
// analysis; the app runs on Safety.
export const settings = [
  {
    key: 'efficiency',
    label: 'Efficiency',
    stats: [
      { key: 'caught', label: 'Infected patients caught', value: '96.9%', interval: '83.8–99.9%' },
      { key: 'cleared', label: 'Healthy patients cleared', value: '96.7%', interval: '83.8–99.9%' },
      { key: 'reviewed', label: 'Samples a technician reviews', value: '45.8%', interval: '33.4–58.7%', signal: true },
    ],
    rule: 'A tile counts if it scores above 0.99. No tiles: negative. More than 12: positive.',
    note: 'Fewer reviews. In testing, one lightly infected patient was cleared when its eggs fell just below the bar.',
  },
  {
    key: 'safety',
    label: 'Safety',
    isDefault: true,
    stats: [
      { key: 'caught', label: 'Infected patients caught', value: '100%', interval: 'at least 89.1%' },
      { key: 'cleared', label: 'Healthy patients cleared', value: '96.5%', interval: '83.5–99.9%' },
      { key: 'reviewed', label: 'Samples a technician reviews', value: '72.1%', interval: '59.6–82.5%', signal: true },
    ],
    rule: 'A tile counts if it scores above 0.95. No tiles: negative. More than 35: positive.',
    note: 'No infected patient was cleared in testing. More samples go to a technician in return.',
  },
]

export const alternatives = [
  { name: 'Any tile looks like an egg', caught: '100.0%', cleared: '0.0%', reviewed: '0%' },
  { name: 'Highest tile, one cut-off', caught: '85.6%', cleared: '83.6%', reviewed: '0%' },
  { name: 'Tile count, one cut-off', caught: '79.4%', cleared: '86.7%', reviewed: '0%' },
  { name: 'Random referral, same workload', caught: '88.8%', cleared: '93.3%', reviewed: '45.8%' },
  { name: 'Bilharz triage (Efficiency)', caught: '96.9%', cleared: '96.7%', reviewed: '45.8%', ours: true },
  { name: 'Bilharz triage (Safety)', caught: '100%', cleared: '96.5%', reviewed: '72.1%', ours: true },
  { name: 'Full human review', caught: '100%', cleared: '100%', reviewed: '100%' },
]

// Flagging a patient when any tile scores above 0.5.
export const anyTile = { threshold: 0.5, cleared: '0%' }

export const referral = {
  referredShare: 'half',
  confidenceError: '8.0%',
  randomError: '20.9%',
  wins: 20,
  repetitions: 20,
}
