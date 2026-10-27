import { Fragment, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { REVIEWS_CSV_URL, getReviews } from '../api.js'
import { pending, useApi } from '../useApi.js'
import { formatTime } from '../format.js'
import OutcomeMark from '../components/OutcomeMark.jsx'
import PageState from '../components/PageState.jsx'
import VerdictMark from '../components/VerdictMark.jsx'
import { SearchIcon } from '../components/Icons.jsx'
import './Queue.css'
import './Reviews.css'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'infected', label: 'Infected' },
  { key: 'healthy', label: 'Healthy' },
]

const getAllVersions = () => getReviews('all')

// One row per reviewed sample: its current review. Earlier versions are kept
// as the audit trail and shown on request.
export default function Reviews() {
  const current = useApi(getReviews)
  const versions = useApi(getAllVersions)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(() => new Set())
  const notice = useNotice()

  const waiting = pending(current, versions)
  if (waiting) return <PageState {...waiting} />

  const reviews = current.data
  const earlier = new Map()
  for (const v of versions.data) {
    const isCurrent = reviews.some((r) => r.id === v.id)
    if (!isCurrent) earlier.set(v.sampleId, [...(earlier.get(v.sampleId) ?? []), v])
  }
  const count = (key) => (key === 'all' ? reviews.length : reviews.filter((r) => r.verdict === key).length)
  const term = search.trim().toLowerCase()
  const rows = reviews.filter(
    (r) => (filter === 'all' || r.verdict === filter) && (!term || r.sampleId.toLowerCase().includes(term)),
  )

  function toggle(sampleId) {
    setOpen((s) => {
      const next = new Set(s)
      if (next.has(sampleId)) next.delete(sampleId)
      else next.add(sampleId)
      return next
    })
  }

  return (
    <div className="container page">
      <header className="queue__head">
        <div>
          <h1 className="headline h1">Reviews</h1>
          <p className="lead queue__summary">
            {reviews.length} {reviews.length === 1 ? 'sample' : 'samples'} reviewed.
          </p>
        </div>
        {reviews.length > 0 && (
          <a className="btn btn--primary" href={REVIEWS_CSV_URL} download="bilharz-reviews.csv">
            Export CSV
          </a>
        )}
      </header>

      <p className="reviews__notice" role="status">
        {notice}
      </p>

      {reviews.length === 0 ? (
        <p className="reviews__empty">
          No reviews yet. Referred samples appear in the{' '}
          <Link to="/queue" className="text-link">
            Queue
          </Link>
          .
        </p>
      ) : (
        <>
          <div className="queue__controls">
            <div className="queue__tabs" role="group" aria-label="Filter by verdict">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className="queue__tab"
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label} <span className="queue__tab-count">{count(f.key)}</span>
                </button>
              ))}
            </div>
            <div className="queue__search">
              <label className="visually-hidden" htmlFor="reviews-search">
                Find a sample
              </label>
              <SearchIcon className="queue__search-icon" />
              <input
                id="reviews-search"
                className="input queue__search-input"
                type="search"
                placeholder="Find a sample"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="queue__table-wrap" tabIndex={0} role="region" aria-label="Reviews">
            <table className="queue__table reviews__table">
              <thead>
                <tr>
                  <th scope="col">Sample</th>
                  <th scope="col">Bilharz decision</th>
                  <th scope="col">Reviewer verdict</th>
                  <th scope="col">Note</th>
                  <th scope="col">Tester</th>
                  <th scope="col">Time</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const older = earlier.get(r.sampleId) ?? []
                  const expanded = open.has(r.sampleId)
                  return (
                    <Fragment key={r.sampleId}>
                      <tr>
                        <th scope="row">
                          <Link to={`/samples/${r.sampleId}`} className="queue__id">
                            {r.sampleId}
                          </Link>
                          {r.versionCount > 1 && (
                            <button
                              type="button"
                              className="reviews__versions"
                              aria-expanded={expanded}
                              aria-controls={`versions-${r.sampleId}`}
                              onClick={() => toggle(r.sampleId)}
                            >
                              {r.versionCount} versions
                            </button>
                          )}
                        </th>
                        <td>{r.decision ? <OutcomeMark kind={r.decision} /> : <span className="muted">—</span>}</td>
                        <td>
                          <VerdictMark verdict={r.verdict} />
                        </td>
                        <NoteCell note={r.note} />
                        <td className={r.testerCode ? undefined : 'muted'}>{r.testerCode ?? '—'}</td>
                        <td>
                          <time dateTime={r.createdAt}>{formatTime(r.createdAt)}</time>
                        </td>
                        <td className="queue__action">
                          <Link
                            to={`/review/${r.sampleId}?edit=1`}
                            className="text-link"
                            aria-label={`Edit the review of ${r.sampleId}`}
                          >
                            Edit
                          </Link>
                        </td>
                      </tr>
                      {expanded &&
                        older.map((v, i) => (
                          <tr key={v.id} id={i === 0 ? `versions-${r.sampleId}` : undefined} className="reviews__old">
                            <th scope="row">
                              <span className="reviews__replaced">Replaced</span>
                            </th>
                            <td />
                            <td>
                              <VerdictMark verdict={v.verdict} />
                            </td>
                            <NoteCell note={v.note} />
                            <td className={v.testerCode ? undefined : 'muted'}>{v.testerCode ?? '—'}</td>
                            <td>
                              <time dateTime={v.createdAt}>{formatTime(v.createdAt)}</time>
                            </td>
                            <td />
                          </tr>
                        ))}
                    </Fragment>
                  )
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="queue__empty">
                      No review matches this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function NoteCell({ note }) {
  return (
    <td className="reviews__note-cell">
      {note ? (
        <span className="reviews__note" tabIndex={0} title={note}>
          {note}
        </span>
      ) : (
        <span className="muted">—</span>
      )}
    </td>
  )
}

// A one-off message passed in router state (e.g. "Review updated"), cleared
// from history so it doesn't come back on reload.
function useNotice() {
  const location = useLocation()
  const navigate = useNavigate()
  const [notice] = useState(() => location.state?.notice ?? '')
  useEffect(() => {
    if (location.state?.notice) navigate(location.pathname, { replace: true, state: null })
  }, [location.state, location.pathname, navigate])
  return notice
}
