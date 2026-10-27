export function formatCount(n) {
  return n.toLocaleString('en-US')
}

export function tilesLookLikeEggs(n) {
  return n === 1 ? '1 tile looks like an egg.' : `${formatCount(n)} tiles look like eggs.`
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

// A review time in the reader's time zone, e.g. "26 Oct, 15:07".
export function formatTime(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${day}, ${time}`
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

// The exact local date and time, e.g. "26 Oct 2026, 15:07".
export function formatFull(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  return `${day}, ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}
