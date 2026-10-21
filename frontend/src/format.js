export function formatCount(n) {
  return n.toLocaleString('en-US')
}

export function tilesLookLikeEggs(n) {
  return n === 1 ? '1 tile looks like an egg.' : `${formatCount(n)} tiles look like eggs.`
}

export function confidentTiles(n) {
  return `${formatCount(n)} confident ${n === 1 ? 'tile' : 'tiles'}`
}
