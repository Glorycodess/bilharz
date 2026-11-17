// The words for outcomes and verdicts, wherever they are shown.
export const OUTCOME_WORDS = { negative: 'Negative', referred: 'Referred', positive: 'Positive' }
export const VERDICT_WORDS = { infected: 'Infected', healthy: 'Healthy' }

export function formatCount(n) {
  return n.toLocaleString('en-US')
}

export function tilesLookLikeEggs(n) {
  return n === 1 ? '1 tile looks like an egg.' : `${formatCount(n)} tiles look like eggs.`
}

// The decision in one plain sentence, with the cut-offs of the setting that
// made it (`rule`: clearBelow, flagAbove and label, as from getConfig).
export function decisionSentence(decision, n, { clearBelow, flagAbove, label }) {
  const seen =
    n === 0 ? 'no tile looks like an egg' : n === 1 ? '1 tile looks like an egg' : `${formatCount(n)} tiles look like eggs`
  const setting = `under the ${label} setting`
  if (decision === 'negative') {
    const why = clearBelow === 1 ? '' : `, fewer than the ${clearBelow} it takes to refer a sample ${setting}`
    return `Negative: ${seen}${why}, so the sample was cleared without review.`
  }
  if (decision === 'positive') {
    return `Positive: ${seen}, more than the ${flagAbove} it takes to confirm ${setting}, so the sample was confirmed without review.`
  }
  return `Referred: ${seen}, too many to clear and too few to confirm (confirming takes more than ${flagAbove} ${setting}), so a technician should review it.`
}

export function confidentTiles(n) {
  return `${formatCount(n)} confident ${n === 1 ? 'tile' : 'tiles'}`
}

// A setting's rule in words, e.g. "A tile counts if it scores above 0.95. No
// tiles: negative. More than 35: positive."
export function ruleText({ tileThreshold, clearBelow, flagAbove }) {
  const negative = clearBelow === 1 ? 'No tiles' : `Fewer than ${clearBelow} tiles`
  return `A tile counts if it scores above ${tileThreshold}. ${negative}: negative. More than ${flagAbove}: positive.`
}

// A date and time in the reader's time zone; '' for an invalid date.
function dayAndTime(iso, withYear) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(withYear && { year: 'numeric' }) })
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${day}, ${time}`
}

// A review time, e.g. "26 Oct, 15:07".
export function formatTime(iso) {
  return dayAndTime(iso, false)
}

// "just now", "5 minutes ago", "2 hours ago", "yesterday", "3 days ago", or a date.
export function formatRelative(iso, now = Date.now()) {
  const date = new Date(iso)
  const seconds = Math.round((date.getTime() - now) / 1000)
  if (Number.isNaN(seconds)) return ''
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const abs = Math.abs(seconds)
  if (abs < 45) return 'just now'
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour')
  if (abs < 7 * 86400) return rtf.format(Math.round(seconds / 86400), 'day')
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// The exact date and time, e.g. "26 Oct 2026, 15:07".
export function formatFull(iso) {
  return dayAndTime(iso, true)
}
