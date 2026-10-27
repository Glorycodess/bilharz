// Checks a running backend against the fields the frontend relies on (the
// ones src/api.js reads). Run with `npm run check:api`; set BILHARZ_API_URL to
// check a backend other than http://localhost:8000.

const BASE = (process.env.BILHARZ_API_URL || 'http://localhost:8000').replace(/\/$/, '')

const DECISION = { oneOf: ['negative', 'positive', 'referred'] }
const VERDICT = { oneOf: ['infected', 'healthy'] }
const nullable = (type) => ({ nullable: type })
const object = (shape) => ({ object: shape })
const array = (shape) => ({ array: object(shape) })

const RULE = object({ tile_threshold: 'number', clear_below: 'number', flag_above: 'number' })

const REVIEW_ITEM = {
  id: 'number',
  sample_id: 'string',
  decision: nullable(DECISION),
  verdict: VERDICT,
  note: nullable('string'),
  tester_code: nullable('string'),
  created_at: 'string',
  supersedes: nullable('number'),
  version_count: 'number',
}

const CHECKS = [
  {
    path: '/api/config',
    shape: object({ default: 'string', settings: { values: RULE } }),
  },
  {
    path: '/api/samples',
    shape: object({
      samples: array({
        id: 'string',
        confident_tiles: 'number',
        decision: DECISION,
        review: nullable(object({ verdict: VERDICT, created_at: 'string' })),
      }),
    }),
  },
  {
    path: '/api/samples/DT40',
    shape: object({
      id: nullable('string'),
      source: { oneOf: ['stored', 'upload'] },
      setting: 'string',
      tile_threshold: 'number',
      confident_tiles: 'number',
      decision: DECISION,
      tiles_scored: 'number',
      highest_score: 'number',
      highest_tile: object({ image: 'string', tile: 'number' }),
      top_tiles: array({ rank: 'number', score: 'number', image: 'string', tile: 'number', confident: 'boolean', url: 'string' }),
      review: nullable(
        object({
          id: 'number',
          verdict: VERDICT,
          created_at: 'string',
          note: nullable('string'),
          tester_code: nullable('string'),
        }),
      ),
      review_count: 'number',
    }),
  },
  { path: '/api/reviews?view=current', shape: array(REVIEW_ITEM) },
  { path: '/api/reviews?view=all', shape: array(REVIEW_ITEM) },
]

function describe(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return typeof value === 'object' ? 'an object' : `${typeof value} ${JSON.stringify(value)}`
}

// Collects a message for every field that is missing or of the wrong type.
function check(value, type, where, problems) {
  if (typeof type === 'string') {
    if (typeof value !== type) problems.push(`${where}: expected ${type}, got ${describe(value)}`)
  } else if (type.nullable) {
    if (value !== null) check(value, type.nullable, where, problems)
  } else if (type.oneOf) {
    if (!type.oneOf.includes(value)) problems.push(`${where}: expected one of ${type.oneOf.join(', ')}, got ${describe(value)}`)
  } else if (type.array) {
    if (!Array.isArray(value)) return problems.push(`${where}: expected an array, got ${describe(value)}`)
    value.forEach((item, i) => check(item, type.array, `${where}[${i}]`, problems))
  } else if (type.values) {
    if (typeof value !== 'object' || value === null) return problems.push(`${where}: expected an object, got ${describe(value)}`)
    for (const [key, item] of Object.entries(value)) check(item, type.values, `${where}.${key}`, problems)
  } else if (type.object) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return problems.push(`${where}: expected an object, got ${describe(value)}`)
    }
    for (const [key, fieldType] of Object.entries(type.object)) {
      if (!(key in value)) problems.push(`${where}.${key}: missing`)
      else check(value[key], fieldType, `${where}.${key}`, problems)
    }
  }
  return problems
}

// Repeated problems across list items are reported once, with a count.
function summarise(problems) {
  const groups = new Map()
  for (const p of problems) {
    const key = p.replace(/\[\d+\]/g, '[]')
    groups.set(key, (groups.get(key) ?? 0) + 1)
  }
  return [...groups].map(([p, n]) => (n > 1 ? `${p} (${n} items)` : p))
}

let failed = false
console.log(`Checking ${BASE} against the fields the frontend uses\n`)

for (const { path, shape } of CHECKS) {
  let body
  try {
    const res = await fetch(BASE + path, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    body = await res.json()
  } catch (error) {
    failed = true
    const reason = error.cause?.code === 'ECONNREFUSED' ? 'nothing is listening there' : error.message
    console.log(`✗ ${path}  could not be read (${reason}). Is the backend running?`)
    continue
  }

  const problems = summarise(check(body, shape, 'response', []))
  const empty = Array.isArray(body) && body.length === 0
  if (problems.length === 0) {
    console.log(`✓ ${path}${empty ? '  (no items yet, so item fields were not checked)' : ''}`)
    continue
  }
  failed = true
  console.log(`✗ ${path}`)
  for (const p of problems) console.log(`    ${p}`)
  const item = body?.samples?.[0] ?? (Array.isArray(body) ? body[0] : body)
  if (item && typeof item === 'object' && 'reviewed' in item && !('review' in item)) {
    console.log('    This is the older API (a `reviewed` flag instead of `review`). Restart the backend to load the current code.')
  }
}

console.log(failed ? '\nThe backend does not match what the frontend expects.' : '\nThe backend matches what the frontend expects.')
process.exit(failed ? 1 : 0)
