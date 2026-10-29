import { useEffect, useState } from 'react'
import { EXPECTED_IMAGES, TILES_PER_IMAGE } from '../../api.js'
import { formatCount } from '../../format.js'
import Button from '../../components/Button.jsx'
import { CheckIcon } from '../../components/Icons.jsx'

const TOTAL_TILES = EXPECTED_IMAGES * TILES_PER_IMAGE

export default function ProgressPanel({ run, onRetry }) {
  const now = useNow(run.phase === 'scoring')

  if (run.phase === 'idle') {
    return (
      <section className="progress progress--empty" aria-label="Analysis progress">
        <p className="eyebrow">Analysing</p>
        <p className="progress__empty">Nothing yet. Choose a folder of images or a sample to start.</p>
      </section>
    )
  }

  if (run.phase === 'failed') {
    return (
      <section className="progress" aria-label="Analysis progress">
        <p className="eyebrow">Analysis stopped</p>
        <p className="progress__error" role="alert">
          {run.message}
        </p>
        {onRetry && (
          <Button variant="link" onClick={onRetry}>
            Try again
          </Button>
        )}
      </section>
    )
  }

  const uploading = run.phase === 'uploading'
  const percent = uploading ? Math.round(run.progress * 100) : 100
  const seconds = uploading ? 0 : Math.max(0, Math.floor((now - run.since) / 1000))
  const steps = [
    { label: `${EXPECTED_IMAGES} images checked`, state: 'done' },
    { label: uploading ? `Uploading ${percent}%` : 'Uploaded', state: uploading ? 'active' : 'done' },
    { label: `Scoring ${formatCount(TOTAL_TILES)} tiles`, state: uploading ? 'pending' : 'active' },
    { label: 'Decision', state: 'pending' },
  ]

  return (
    <section className="progress" aria-label="Analysis progress">
      <p className="eyebrow">Analysing</p>
      <p className="progress__id number">Your sample</p>
      {uploading ? (
        <div
          className="progress__track"
          role="progressbar"
          aria-label="Upload"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div className="progress__fill" style={{ width: `${percent}%` }} />
        </div>
      ) : (
        <div className="progress__track progress__track--busy" role="progressbar" aria-label="Scoring tiles">
          <div className="progress__fill" />
        </div>
      )}
      <p className="progress__count" aria-live="polite">
        {uploading ? `Uploading ${percent}%` : `Scoring ${formatCount(TOTAL_TILES)} tiles… ${seconds} s`}
      </p>
      <ol className="progress__steps">
        {steps.map((s) => (
          <li key={s.label} className={`progress__step progress__step--${s.state}`}>
            <span className="progress__icon" aria-hidden="true">
              {s.state === 'done' ? <CheckIcon /> : <span className="progress__dot" />}
            </span>
            {s.label}
            <span className="visually-hidden">
              {s.state === 'done' ? ', done' : s.state === 'active' ? ', in progress' : ''}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

// The current time, updated every second while `active`.
function useNow(active) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}
