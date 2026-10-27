// All network access. Pages and components call these functions and get
// camelCase data back; the backend's snake_case stays inside this file.
// The fields read here must match api/bilharz/schemas.py; `npm run check:api`
// checks a running backend against them.
// URLs are relative, so the same build works wherever the API is served from.
import { settings, alternatives, anyTile, referral } from './data/performance.js'

export const EXPECTED_IMAGES = 117
export const TILES_PER_IMAGE = 12

export const WAKING_MESSAGE = 'The server is waking up. This can take up to a minute.'

const UPLOAD_MESSAGES = {
  408: 'The upload took too long. Check your connection and try again.',
  413: 'The images are too large to upload. Each image can be at most 15 MB.',
  415: 'One of the files is not a JPEG image.',
  422: `The sample must be exactly ${EXPECTED_IMAGES} JPEG images.`,
  429: 'Another sample is being analysed right now. Try again in a minute.',
}

export class ApiError extends Error {
  constructor(message, { status = 0, unreachable = false } = {}) {
    super(message)
    this.status = status
    this.unreachable = unreachable
  }
}

function unreachable() {
  return new ApiError(WAKING_MESSAGE, { unreachable: true })
}

// The backend's own message where it gave one; otherwise a plain fallback.
function errorFor(status, body, fallbacks = {}) {
  if (status === 502 || status === 503 || status === 504) return unreachable()
  const detail = typeof body?.detail === 'string' ? body.detail : null
  const message = detail ?? fallbacks[status] ?? 'Something went wrong. Please try again.'
  return new ApiError(message, { status })
}

async function send(path, options = {}) {
  let res
  try {
    res = await fetch(path, { ...options, headers: { Accept: 'application/json', ...options.headers } })
  } catch {
    throw unreachable()
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) throw errorFor(res.status, body)
  return body
}

// Identical GETs already on their way share one request (the header and the
// page often ask for the same data at once), which spares a waking server.
const inFlight = new Map()

function request(path, options) {
  if (options?.method && options.method !== 'GET') return send(path, options)
  const key = `${path} ${JSON.stringify(options?.headers ?? {})}`
  if (!inFlight.has(key)) {
    inFlight.set(key, send(path, options).finally(() => inFlight.delete(key)))
  }
  return inFlight.get(key)
}

// The review access code, when the server asks for one. Kept in this
// module's memory only (never in storage), so it lasts until the tab reloads.
let reviewCode = null
let reviewCodeProblem = null

export function hasReviewCode() {
  return reviewCode !== null
}

// Why the code was last rejected, for the code form ("That review code isn't valid.").
export function reviewCodeError() {
  return reviewCodeProblem
}

export function setReviewCode(code) {
  reviewCode = code
  reviewCodeProblem = null
  dataChanged()
}

function reviewHeaders() {
  return reviewCode ? { 'X-Review-Code': reviewCode } : {}
}

// A review request was refused for its code: forget the code and ask again.
async function withReviewCode(call) {
  try {
    return await call()
  } catch (error) {
    if (error.status === 403) {
      reviewCode = null
      reviewCodeProblem = error.message
      dataChanged()
    }
    throw error
  }
}

// Every view that shows server data listens here, so a recorded review
// refreshes the queue, the header badge and the next-sample link.
const listeners = new Set()
let version = 0

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function dataVersion() {
  return version
}

function dataChanged() {
  version += 1
  listeners.forEach((listener) => listener())
}

// Converters ---------------------------------------------------------------

function label(key) {
  return key.charAt(0).toUpperCase() + key.slice(1)
}

function toRule(key, r) {
  return {
    key,
    label: label(key),
    tileThreshold: r.tile_threshold,
    clearBelow: r.clear_below,
    flagAbove: r.flag_above,
  }
}

function toReview(r) {
  if (!r) return null
  return {
    id: r.id ?? null,
    verdict: r.verdict,
    createdAt: r.created_at,
    note: r.note ?? null,
    testerCode: r.tester_code ?? null,
    supersedes: r.supersedes ?? null,
    // The server withheld the note and tester code (review code required, not sent).
    detailsHidden: r.details_hidden ?? false,
  }
}

function toResult(r) {
  return {
    id: r.id,
    source: r.source,
    setting: r.setting,
    tileThreshold: r.tile_threshold,
    confidentTiles: r.confident_tiles,
    decision: r.decision,
    tilesScored: r.tiles_scored,
    highestScore: r.highest_score,
    highestTile: { image: r.highest_tile.image, tile: r.highest_tile.tile },
    topTiles: r.top_tiles.map((t) => ({
      rank: t.rank,
      score: t.score,
      image: t.image,
      tile: t.tile,
      confident: t.confident,
      imageUrl: t.url,
    })),
    seconds: r.seconds ?? null,
    review: toReview(r.review),
    reviewCount: r.review_count ?? 0,
  }
}

// Endpoints ----------------------------------------------------------------

export async function getHealth() {
  return request('/api/health')
}

// The default setting's rule, plus every setting by key.
export async function getConfig() {
  const body = await request('/api/config')
  const rules = Object.fromEntries(Object.entries(body.settings).map(([key, r]) => [key, toRule(key, r)]))
  const current = rules[body.default]
  return { ...current, setting: current.label, settings: rules, reviewCodeRequired: body.review_code_required }
}

export async function getQueue() {
  const body = await request('/api/samples')
  return body.samples.map((s) => ({
    id: s.id,
    confidentTiles: s.confident_tiles,
    decision: s.decision,
    review: toReview(s.review),
  }))
}

// Resolves to null for an unknown ID.
export async function getSample(id) {
  try {
    // Sent with the review code, if one was entered, so the review's note is included.
    return toResult(await request(`/api/samples/${encodeURIComponent(id)}`, { headers: reviewHeaders() }))
  } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}

// Reviews, newest first, with Bilharz's own decision for each sample.
// 'current': one per sample, its latest version. 'all': every version.
export async function getReviews(view = 'current') {
  const body = await withReviewCode(() => request(`/api/reviews?view=${view}`, { headers: reviewHeaders() }))
  return body.map((r) => ({
    ...toReview(r),
    sampleId: r.sample_id,
    decision: r.decision,
    versionCount: r.version_count,
  }))
}

// Every version of every review as a CSV file, saved by the browser. Needs the
// admin token, which is sent once and not kept anywhere.
export async function downloadReviewsCsv(adminToken) {
  let res
  try {
    res = await fetch('/api/reviews.csv', { headers: { 'X-Admin-Token': adminToken } })
  } catch {
    throw unreachable()
  }
  if (res.status === 403) {
    const body = await res.json().catch(() => null)
    const off = typeof body?.detail === 'string' && body.detail.includes('turned off')
    throw new ApiError(off ? 'Export is turned off on this server: no admin token is set.' : "That token isn't valid.", {
      status: 403,
    })
  }
  if (!res.ok) throw errorFor(res.status, await res.json().catch(() => null))
  const url = URL.createObjectURL(await res.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = 'bilharz-reviews.csv'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// A new review, or, with `supersedes` (the current review's id), a new version of it.
export async function postReview(id, { verdict, note, supersedes = null }) {
  const body = await withReviewCode(() =>
    request(`/api/reviews/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...reviewHeaders() },
      body: JSON.stringify({ verdict, note: note || null, supersedes }),
    }),
  )
  dataChanged()
  return body
}

// Upload one sample's images. Reports upload progress (0–1), then `onUploaded`
// once the server has everything and is scoring. Files are sent under neutral
// names, so their original names never leave the browser.
export function analyseUpload(files, { onProgress, onUploaded, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/analyse')
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.upload.onload = () => onUploaded?.()
    xhr.onload = () => {
      let body = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        // not JSON: handled by the status below
      }
      if (xhr.status === 200 && body) resolve(toResult(body))
      else reject(errorFor(xhr.status, body, UPLOAD_MESSAGES))
    }
    xhr.onerror = () => reject(unreachable())
    xhr.onabort = () => reject(new ApiError('The upload was cancelled.'))
    signal?.addEventListener('abort', () => xhr.abort())

    const form = new FormData()
    files.forEach((file, i) => form.append('files', file, `upload_${String(i + 1).padStart(3, '0')}.jpg`))
    xhr.send(form)
  })
}

// Research results: fixed figures from the evaluation, not live data.
export async function getPerformance() {
  return { settings, alternatives, anyTile, referral }
}

// The one definition of "reviewed" and "waiting", used by every count and
// label. A missing review is the same as no review.
export function isReviewed(sample) {
  return sample.review != null
}

export function isWaiting(sample) {
  return sample.decision === 'referred' && !isReviewed(sample)
}

export function countWaiting(queue) {
  return queue.filter(isWaiting).length
}
