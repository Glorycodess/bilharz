import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { chooseSetting, getConfig, getPerformance } from '../api.js'
import { pending, useApi } from '../useApi.js'
import { ruleText } from '../format.js'
import PageHeader from '../components/PageHeader.jsx'
import PageState from '../components/PageState.jsx'
import Button from '../components/Button.jsx'
import { CheckIcon } from '../components/Icons.jsx'
import StatBlock from '../components/StatBlock.jsx'
import './Performance.css'

export default function Performance() {
  const performance = useApi(getPerformance)
  const config = useApi(getConfig)
  const [selected, setSelected] = useState(null)
  const { hash } = useLocation()
  const loaded = performance.data !== undefined && config.data !== undefined

  // The menu's "Change" link opens this page at the control.
  useEffect(() => {
    if (loaded && hash === '#use-setting') document.getElementById('use-setting')?.scrollIntoView({ block: 'center' })
  }, [loaded, hash])

  const waiting = pending(performance, config)
  if (waiting) return <PageState {...waiting} />

  const { settings, alternatives, referral } = performance.data
  const current = settings.find((s) => s.key === selected) ?? settings.find((s) => s.key === config.data.key)
  const rule = config.data.settings[current.key]

  return (
    <div className="container page">
      <PageHeader
        title="How well it works"
        summary="Two settings trade review workload against safety. Choose one to see what it means."
      />

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
            {s.key === config.data.defaultKey && ' (default)'}
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
              note={`95% interval ${stat.interval}`}
              signal={stat.signal}
              tone={stat.signal ? 'referred' : undefined}
            />
          ))}
        </div>
        <div className="perf__rule">
          {rule && <p className="strong">{ruleText(rule)}</p>}
          <p className="muted">{current.note}</p>
        </div>
        <UseSetting setting={current} inUse={config.data} />
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

// Makes the setting shown above the one the app uses, in this browser.
function UseSetting({ setting, inUse }) {
  const status = useRef(null)
  const [justChosen, setJustChosen] = useState(false)
  const active = setting.key === inUse.key

  useEffect(() => {
    if (justChosen && active) status.current?.focus()
  }, [justChosen, active])

  return (
    <div className="perf__use" id="use-setting">
      {active ? (
        <p className="perf__use-status strong" ref={status} tabIndex={-1} role="status">
          <CheckIcon className="perf__use-icon" />
          {setting.label} is the setting in use in the app.
        </p>
      ) : (
        <Button
          variant="outline"
          onClick={() => {
            setJustChosen(true)
            chooseSetting(setting.key)
          }}
        >
          Use this setting in the app
        </Button>
      )}
      <p className="muted small">
        {active ? 'It decides' : `In use now: ${inUse.label}. The setting decides`} the queue, sample results and new
        analyses in this browser. Reviews are not affected.
      </p>
    </div>
  )
}
