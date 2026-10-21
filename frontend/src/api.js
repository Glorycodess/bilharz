// The only module that reads src/data. Each function is async so the
// backend can replace it without changing the components.
import { config } from './data/config.js'
import { samples, topTiles } from './data/samples.js'
import { settings, alternatives, anyTile, referral } from './data/performance.js'

export function decide(confidentTiles) {
  if (confidentTiles < config.clearBelow) return 'negative'
  if (confidentTiles > config.flagAbove) return 'positive'
  return 'referred'
}

function withDecision(sample) {
  return { ...sample, decision: decide(sample.confidentTiles) }
}

export async function getConfig() {
  return { ...config, tilesPerSample: config.imagesPerSample * config.tilesPerImage }
}

export async function getQueue() {
  return samples.map(withDecision)
}

// Resolves to null for an unknown ID.
export async function getSample(id) {
  const sample = samples.find((s) => s.id === id)
  if (!sample) return null
  const tiles = topTiles[id] ?? null
  return {
    ...withDecision(sample),
    topTiles: tiles,
    highestTile: tiles ? tiles[0] : null,
  }
}

export async function getPerformance() {
  return { settings, alternatives, anyTile, referral }
}
