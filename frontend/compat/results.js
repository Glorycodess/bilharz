// One CSV row per browser, viewport and page, written to
// docs/evidence/compatibility/results-<local|live>.csv. The global setup
// starts the file; the teardown it returns sorts the rows.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const EVIDENCE = fileURLToPath(new URL('../../docs/evidence/compatibility/', import.meta.url))
const HEADER = 'browser,version,viewport,page,load_ms,document_width,console_errors,tiles_loaded,passed'

function file() {
  return `${EVIDENCE}results-${process.env.BILHARZ_COMPAT_URL ? 'live' : 'local'}.csv`
}

export function record(row) {
  appendFileSync(file(), `${row.join(',')}\n`)
}

export default function setup() {
  mkdirSync(EVIDENCE, { recursive: true })
  writeFileSync(file(), '')
  return () => {
    const rows = readFileSync(file(), 'utf8').trim().split('\n').filter(Boolean).sort()
    writeFileSync(file(), [HEADER, ...rows].join('\n') + '\n')
  }
}
