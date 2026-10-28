import { Fragment, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { getReviews } from '../api.js'
import { pending, useApi } from '../useApi.js'
import { formatFull, formatRelative } from '../format.js'
import ExportDialog from '../components/ExportDialog.jsx'
import OutcomeMark from '../components/OutcomeMark.jsx'
import PageHeader from '../components/PageHeader.jsx'
import PageState from '../components/PageState.jsx'
import ReviewCodeGate from '../components/ReviewCodeGate.jsx'
import SearchField from '../components/SearchField.jsx'
import Toolbar from '../components/Toolbar.jsx'
import VerdictMark from '../components/VerdictMark.jsx'
import './Queue.css'
import './Reviews.css'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'infected', label: 'Infected' },
  { key: 'healthy', label: 'Healthy' },
]

const getAllVersions = () => getReviews('all')

export default function Reviews() {
  return (
    <div className="container page">
      <ReviewCodeGate header={<PageHeader title="Reviews" />}>
        <ReviewsTable />
      </ReviewCodeGate>
    </div>
  )
}

// One row per reviewed sample: its current review. Earlier versions are kept
// as the audit trail and shown on request.
function ReviewsTable() {
  const current = useApi(getReviews)
  const versions = useApi(getAllVersions)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(() => new Set())
  const notice = useNotice()

  const waiting = pending(current, versions)
  if (waiting) return <PageState {...waiting} />

  const reviews = current.data
  const currentIds = new Set(reviews.map((r) => r.id))
  const earlier = new Map()
  for (const v of versions.data) {
    if (!currentIds.has(v.id)) earlier.set(v.sampleId, [...(earlier.get(v.sampleId) ?? []), v])
  }
  const count = (key) => (key === 'all' ? reviews.length : reviews.filter((r) => r.verdict === key).length)
  // Only worth a column if some reviewed sample wasn't simply referred.
  const showDecision = reviews.some((r) => r.decision !== 'referred')
  const columns = showDecision ? 7 : 6
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
    <>
      <PageHeader
        title="Reviews"
        summary={`${reviews.length} reviewed · ${count('infected')} infected · ${count('healthy')} healthy`}
      />

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
          <Toolbar
            start={
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
            }
            end={
              <>
                <SearchField id="reviews-search" value={search} onChange={setSearch} />
                <ExportDialog />
              </>
            }
          />

          <div className="queue__table-wrap" tabIndex={0} role="region" aria-label="Reviews">
            <table className={`queue__table reviews__table${showDecision ? ' reviews__table--wide' : ''}`}>
              <thead>
                <tr>
                  <th scope="col">Sample</th>
                  {showDecision && <th scope="col">Bilharz decision</th>}
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
                        {showDecision && <td>{r.decision && <OutcomeMark kind={r.decision} />}</td>}
                        <td>
                          <VerdictMark verdict={r.verdict} />
                        </td>
                        <NoteCell note={r.note} />
                        <td>{r.testerCode}</td>
                        <TimeCell iso={r.createdAt} />
                        <td className="queue__action">
                          <Link
                            to={`/review/${r.sampleId}?edit=1`}
                            className="row-action"
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
                            {showDecision && <td />}
                            <td>
                              <VerdictMark verdict={v.verdict} />
                            </td>
                            <NoteCell note={v.note} />
                            <td>{v.testerCode}</td>
                            <TimeCell iso={v.createdAt} />
                            <td />
                          </tr>
                        ))}
                    </Fragment>
                  )
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={columns} className="queue__empty">
                      No review matches this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}

function NoteCell({ note }) {
  return (
    <td className="reviews__note-cell">
      {note && (
        <span className="reviews__note" tabIndex={0} title={note}>
          {note}
        </span>
      )}
    </td>
  )
}

function TimeCell({ iso }) {
  const exact = formatFull(iso)
  return (
    <td>
      <time dateTime={iso} title={exact}>
        {formatRelative(iso)}
      </time>
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
