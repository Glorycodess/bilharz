import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getConfig, getPerformance, getQueue } from '../api.js'
import { useApi } from '../useApi.js'
import { countWaiting, useReviews } from '../reviews.js'
import Button from '../components/Button.jsx'
import OutcomeMark from '../components/OutcomeMark.jsx'
import { SearchIcon } from '../components/Icons.jsx'
import './Queue.css'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'referred', label: 'Referred' },
  { key: 'negative', label: 'Negative' },
  { key: 'positive', label: 'Positive' },
]

export default function Queue() {
  const queue = useApi(getQueue)
  const config = useApi(getConfig)
  const performance = useApi(getPerformance)
  const { reviews } = useReviews()
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')

  if (!queue || !config || !performance) return <div className="container page" aria-busy="true" />

  const reviewed = new Set(reviews.map((r) => r.id))
  const count = (key) => (key === 'all' ? queue.length : queue.filter((s) => s.decision === key).length)
  const waiting = countWaiting(queue, reviews)
  const referred = count('referred')
  const estimate = performance.settings
    .find((s) => s.key === config.setting.toLowerCase())
    .stats.find((s) => s.key === 'reviewed').value
  const term = search.trim().toLowerCase()
  const rows = queue.filter(
    (s) => (filter === 'all' || s.decision === filter) && (!term || s.id.toLowerCase().includes(term)),
  )

  return (
    <div className="container page">
      <header className="queue__head">
        <div>
          <h1 className="headline h1">Queue</h1>
          <p className="lead queue__summary">
            {queue.length} samples analysed.{' '}
            <span className="strong">
              {waiting} waiting for a technician.
            </span>
          </p>
        </div>
        <Button to="/analyse">Analyse a sample</Button>
      </header>

      <div className="queue__controls">
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
      </div>

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
              const status = reviewed.has(s.id)
                ? 'Reviewed'
                : referred
                  ? 'Waiting for review'
                  : 'Decided automatically'
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
                  <td className={status === 'Decided automatically' ? 'muted' : undefined}>{status}</td>
                  <td className="queue__action">
                    <Link to={to} className="text-link" aria-label={`${referred ? 'Review' : 'View'} ${s.id}`}>
                      {referred ? 'Review' : 'View'} <span aria-hidden="true">→</span>
                    </Link>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="queue__empty">
                  No sample matches &ldquo;{search.trim()}&rdquo;.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="muted small queue__foot">Decisions from the {config.setting} setting.</p>
      <p className="muted small queue__foot-more">
        {referred} of {queue.length} samples are referred by the final rule, fitted on all {queue.length} patients. For
        new patients, the cross-validated estimate is {estimate}.
      </p>
    </div>
  )
}
