import { useState } from 'react'
import { getPerformance } from '../api.js'
import { useApi } from '../useApi.js'
import StatBlock from '../components/StatBlock.jsx'
import './Performance.css'

export default function Performance() {
  const data = useApi(getPerformance)
  const [selected, setSelected] = useState(null)

  if (!data) return <div className="container page" aria-busy="true" />

  const { settings, alternatives, referral } = data
  const current = settings.find((s) => s.key === selected) ?? settings.find((s) => s.isDefault)

  return (
    <div className="container page">
      <header className="perf__head">
        <h1 className="headline h1">How well it works</h1>
        <p className="lead">Two settings trade review workload against safety. Choose one to see what it means.</p>
      </header>

      <div className="segmented" role="group" aria-label="Decision setting">
        {settings.map((s) => (
          <button
            key={s.key}
            type="button"
            className="segmented__option"
            aria-pressed={s.key === current.key}
            onClick={() => setSelected(s.key)}
          >
            {s.label}
            {s.isDefault && ' (default)'}
          </button>
        ))}
      </div>

      <section className="perf__setting" aria-live="polite" aria-label={`${current.label} setting`}>
        <div className="perf__stats">
          {current.stats.map((stat) => (
            <StatBlock
              key={stat.label}
              label={stat.label}
              value={stat.value}
              note={stat.interval}
              signal={stat.signal}
              tone={stat.signal ? 'referred' : undefined}
            />
          ))}
        </div>
        <div className="perf__rule">
          <p className="strong">{current.rule}</p>
          <p className="muted">{current.note}</p>
        </div>
      </section>

      <section className="perf__section" aria-labelledby="alt-title">
        <h2 className="section-title" id="alt-title">
          Against the alternatives
        </h2>
        <div className="perf__table-wrap" tabIndex={0} role="region" aria-labelledby="alt-title">
          <table className="perf__table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="visually-hidden">Approach</span>
                </th>
                <th scope="col">Infected caught</th>
                <th scope="col">Healthy cleared</th>
                <th scope="col">Reviewed by a human</th>
              </tr>
            </thead>
            <tbody>
              {alternatives.map((row) => (
                <tr key={row.name} className={row.ours ? 'perf__ours' : undefined}>
                  <th scope="row">
                    {row.ours && <span className="perf__dot" aria-hidden="true" />}
                    {row.name}
                  </th>
                  <td>{row.caught}</td>
                  <td>{row.cleared}</td>
                  <td>{row.reviewed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="perf__panel" aria-label="Referral by confidence">
        <p className="eyebrow perf__panel-eyebrow">With {referral.referredShare} the samples referred</p>
        <p className="perf__panel-number number">
          <span className="perf__panel-ours">{referral.confidenceError}</span>{' '}
          <span className="perf__panel-vs">vs {referral.randomError}</span>
        </p>
        <p className="perf__panel-text">
          Error among automatic decisions when the least confident samples are referred, against referring at random.
          Confidence wins in {referral.wins} of {referral.repetitions} repetitions.
        </p>
      </section>

      <p className="perf__foot muted small">
        Repeated 5-fold cross-validation over 65 patients from one dataset, with every threshold learned on separate
        patients. Referred samples are assumed read correctly. The Safety setting was designed after one missed
        infection was found and is reported as an extra analysis. Research results, not clinical performance.
      </p>
    </div>
  )
}
