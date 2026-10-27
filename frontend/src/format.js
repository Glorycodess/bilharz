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
