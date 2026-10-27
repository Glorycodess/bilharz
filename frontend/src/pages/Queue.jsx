import { useState } from 'react'
import { Link } from 'react-router-dom'
import { countWaiting, getConfig, getPerformance, getQueue, isReviewed, isWaiting } from '../api.js'
import { pending, useApi } from '../useApi.js'
import OutcomeMark from '../components/OutcomeMark.jsx'
import PageHeader from '../components/PageHeader.jsx'
import PageState from '../components/PageState.jsx'
import Toolbar from '../components/Toolbar.jsx'
import VerdictMark from '../components/VerdictMark.jsx'
import { SearchIcon } from '../components/Icons.jsx'
import './Queue.css'

// Referred means still waiting: a referred sample moves to Reviewed once a
// technician has decided it.
const FILTERS = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'referred', label: 'Referred', test: isWaiting },
  { key: 'negative', label: 'Negative', test: (s) => s.decision === 'negative' },
  { key: 'positive', label: 'Positive', test: (s) => s.decision === 'positive' },
  { key: 'reviewed', label: 'Reviewed', test: isReviewed },
]

export default function Queue() {
  const queueRequest = useApi(getQueue)
  const configRequest = useApi(getConfig)
  const performanceRequest = useApi(getPerformance)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')

  const waitingFor = pending(queueRequest, configRequest, performanceRequest)
  if (waitingFor) return <PageState {...waitingFor} />

  const queue = queueRequest.data
  const config = configRequest.data
  const matches = (key) => FILTERS.find((f) => f.key === key).test
  const count = (key) => queue.filter(matches(key)).length
  const waiting = countWaiting(queue)
  const referred = queue.filter((s) => s.decision === 'referred').length
  const estimate = performanceRequest.data.settings
    .find((s) => s.key === config.key)
    ?.stats.find((s) => s.key === 'reviewed').value
  const term = search.trim().toLowerCase()
  const rows = queue.filter((s) => matches(filter)(s) && (!term || s.id.toLowerCase().includes(term)))

  return (
    <div className="container page">
      <PageHeader
        title="Queue"
        summary={
          <>
            {queue.length} samples · <strong>{waiting} waiting for a technician</strong>
          </>
        }
      />

      <Toolbar
        start={
          <div className="queue__tabs" role="group" aria-label="Filter by decision">
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
          <div className="queue__search">
            <label className="visually-hidden" htmlFor="queue-search">
              Find a sample
            </label>
            <SearchIcon className="queue__search-icon" />
            <input
              id="queue-search"
              className="input queue__search-input"
              type="search"
              placeholder="Find a sample"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        }
      />

      <div className="queue__table-wrap" tabIndex={0} role="region" aria-label="Samples">
        <table className="queue__table">
          <thead>
            <tr>
              <th scope="col">Sample</th>
              <th scope="col" className="num">
                Confident tiles
              </th>
              <th scope="col">Decision</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="visually-hidden">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const referred = s.decision === 'referred'
              const status = isReviewed(s) ? (
                <VerdictMark verdict={s.review.verdict}>
                  Reviewed · {s.review.verdict === 'infected' ? 'Infected' : 'Healthy'}
                </VerdictMark>
              ) : isWaiting(s) ? (
                'Waiting for review'
              ) : (
                'Decided automatically'
              )
              const to = referred ? `/review/${s.id}` : `/samples/${s.id}`
              return (
                <tr key={s.id}>
                  <th scope="row">
                    <Link to={`/samples/${s.id}`} className="queue__id">
                      {s.id}
                    </Link>
                  </th>
                  <td className="num">{s.confidentTiles}</td>
                  <td>
                    <OutcomeMark kind={s.decision} />
                  </td>
                  <td className={!isReviewed(s) && !referred ? 'muted' : undefined}>{status}</td>
                  <td className="queue__action">
                    <Link to={to} className="row-action" aria-label={`${referred ? 'Review' : 'View'} ${s.id}`}>
                      {referred ? 'Review' : 'View'} <span aria-hidden="true">→</span>
                    </Link>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="queue__empty">
                  {term ? <>No sample matches &ldquo;{search.trim()}&rdquo;.</> : 'No samples here yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="muted small queue__foot">Decisions from the {config.setting} setting.</p>
      <p className="muted small queue__foot-more">
        {referred} of {queue.length} samples are referred by the final rule, fitted on all {queue.length} patients. For
        new patients, the cross-validated estimate is {estimate ?? 'not available'}.
      </p>
    </div>
  )
}
