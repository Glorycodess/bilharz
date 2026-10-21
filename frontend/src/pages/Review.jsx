import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getConfig, getQueue, getSample } from '../api.js'
import { useApi } from '../useApi.js'
import { useReviews } from '../reviews.js'
import { confidentTiles } from '../format.js'
import Button from '../components/Button.jsx'
import OutcomeMark from '../components/OutcomeMark.jsx'
import TileCard from '../components/TileCard.jsx'
import SampleNotFound from './SampleNotFound.jsx'
import './Review.css'

const WORDS = { negative: 'Negative', referred: 'Referred', positive: 'Positive' }

const CHOICES = [
  { value: 'infected', label: 'Infected', hint: 'I can see at least one egg', outcome: 'positive' },
  { value: 'healthy', label: 'Healthy', hint: 'No eggs in these tiles', outcome: 'negative' },
]

export default function Review() {
  const { id } = useParams()
  // Keyed so the decision form starts fresh for every sample.
  return <ReviewSample key={id} id={id} />
}

function ReviewSample({ id }) {
  const navigate = useNavigate()
  const sample = useApi(getSample, id)
  const queue = useApi(getQueue)
  const config = useApi(getConfig)
  const { reviews, record } = useReviews()
  const [choice, setChoice] = useState(null)
  const [note, setNote] = useState('')
  // undefined until recorded, then the sample to open next (or null).
  const [movingTo, setMovingTo] = useState(undefined)
  const recorded = movingTo !== undefined

  const reviewed = new Set(reviews.map((r) => r.id))
  const nextId = queue ? findNext(queue, id, reviewed) : null

  useEffect(() => {
    if (!movingTo) return
    const timer = setTimeout(() => navigate(`/review/${movingTo}`), 1400)
    return () => clearTimeout(timer)
  }, [movingTo, navigate])

  if (sample === undefined || config === undefined) return <div className="container page" aria-busy="true" />
  if (sample === null) return <SampleNotFound id={id} />

  const { decision, confidentTiles: n, topTiles } = sample
  const tiles = topTiles ?? Array.from({ length: 12 }, () => null)

  function onSubmit(event) {
    event.preventDefault()
    if (!choice) return
    record({ id, verdict: choice, note: note.trim() })
    setMovingTo(nextId)
  }

  return (
    <div className="container page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/queue">Queue</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/samples/${id}`}>{id}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Review</span>
      </nav>

      <header className="review__head">
        <h1 className="headline h1">Review {id}</h1>
        <OutcomeMark kind={decision} size="lg">
          {WORDS[decision]} · {confidentTiles(n)}
        </OutcomeMark>
        <p className="lead">
          The 12 tiles the detector ranked highest, out of {config.tilesPerSample.toLocaleString('en-US')}. Look for
          an oval egg with a spine at one end. Debris and fibres are the usual false alarms.
        </p>
      </header>

      <div className="review">
        <section aria-label="Top 12 tiles">
          {!topTiles && <p className="muted review__note">Tile scores available once the backend is connected.</p>}
          <div className="review__tiles">
            {tiles.map((t, i) =>
              t ? (
                <TileCard key={i} {...t} rank={i + 1} confident={t.score > config.tileThreshold} />
              ) : (
                <TileCard key={i} rank={i + 1} />
              ),
            )}
          </div>
        </section>

        <aside className="decision" aria-labelledby="decision-title">
          <form onSubmit={onSubmit}>
            <h2 className="section-title" id="decision-title">
              Your decision
            </h2>
            <div className="decision__choices" role="group" aria-labelledby="decision-title">
              {CHOICES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className={`decision__choice decision__choice--${c.outcome}`}
                  aria-pressed={choice === c.value}
                  onClick={() => setChoice(c.value)}
                  disabled={recorded}
                >
                  <span className="decision__choice-label">{c.label}</span>
                  <span className="decision__choice-hint">{c.hint}</span>
                </button>
              ))}
            </div>

            <label className="field-label" htmlFor="review-note">
              Note <span className="muted">(optional)</span>
            </label>
            <textarea
              id="review-note"
              className="input decision__note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={recorded}
            />

            <button type="submit" className="btn btn--primary decision__submit" disabled={!choice || recorded}>
              Record decision
            </button>
            <p className="decision__status" role="status">
              {recorded &&
                (movingTo
                  ? `Decision recorded for ${id}. Opening ${movingTo}.`
                  : `Decision recorded for ${id}. No referred samples left.`)}
            </p>
            <p className="muted small">Decisions are logged for audit and not used to retrain the model.</p>
          </form>

          <div className="decision__next">
            {nextId ? (
              <>
                <span className="muted">Next in queue</span>
                <Button to={`/review/${nextId}`} variant="link">
                  {nextId}
                </Button>
              </>
            ) : (
              <Button to="/queue" variant="link">
                Back to queue
              </Button>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

// The next referred sample after this one that has not been reviewed yet.
function findNext(queue, id, reviewed) {
  const referred = queue.filter((s) => s.decision === 'referred')
  const start = referred.findIndex((s) => s.id === id)
  for (let step = 1; step <= referred.length; step++) {
    const candidate = referred[(start + step) % referred.length]
    if (candidate.id !== id && !reviewed.has(candidate.id)) return candidate.id
  }
  return null
}
