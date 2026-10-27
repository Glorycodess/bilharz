import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { getConfig, getQueue, getSample, isWaiting, postReview } from '../api.js'
import { pending, useApi } from '../useApi.js'
import { confidentTiles, formatCount, formatTime } from '../format.js'
import Button from '../components/Button.jsx'
import EggGuide from '../components/EggGuide.jsx'
import OutcomeMark from '../components/OutcomeMark.jsx'
import PageState from '../components/PageState.jsx'
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
  const editing = useSearchParams()[0].get('edit') === '1'
  // Keyed so the decision form starts fresh for every sample.
  return <ReviewSample key={`${id}:${editing}`} id={id} editing={editing} />
}

// With `editing`, the sample's current review is loaded into the form and
// saving adds a new version that supersedes it.
function ReviewSample({ id, editing }) {
  const navigate = useNavigate()
  const sample = useApi(getSample, id)
  const queue = useApi(getQueue)
  const config = useApi(getConfig)
  const [choice, setChoice] = useState(null)
  const [note, setNote] = useState('')
  // idle → saving → saved (with the sample to open next), or back to idle with an error.
  const [save, setSave] = useState({ status: 'idle', error: null, next: null })
  const [prefilledFrom, setPrefilledFrom] = useState(null)
  const busy = save.status !== 'idle'

  const current = sample.data?.review ?? null
  const amending = editing && current !== null
  // Load the current review into the form, and again if it changes (after a 409).
  if (amending && prefilledFrom !== current.id) {
    setPrefilledFrom(current.id)
    setChoice(current.verdict)
    setNote(current.note ?? '')
  }

  const nextId = queue.data ? findNext(queue.data, id) : null

  useEffect(() => {
    if (save.status !== 'saved' || !save.next) return
    const timer = setTimeout(() => navigate(`/review/${save.next}`), 1400)
    return () => clearTimeout(timer)
  }, [save, navigate])

  const waiting = pending(sample)
  if (waiting) return <PageState {...waiting} />
  if (sample.data === null) return <SampleNotFound id={id} />

  const { decision, confidentTiles: n, topTiles, tilesScored, tileThreshold } = sample.data
  const threshold = config.data?.settings[sample.data.setting]?.tileThreshold ?? tileThreshold

  async function onSubmit(event) {
    event.preventDefault()
    if (!choice || busy) return
    const next = nextId
    setSave({ status: 'saving', error: null, next: null })
    try {
      if (amending) {
        await postReview(id, { verdict: choice, note: note.trim(), supersedes: current.id })
        navigate('/reviews', { state: { notice: `Review updated for ${id}.` } })
        return
      }
      await postReview(id, { verdict: choice, note: note.trim() })
      setSave({ status: 'saved', error: null, next })
    } catch (error) {
      // Keep the reviewer's choice and note so they can try again. If someone
      // else changed the review first, load their version.
      setSave({ status: 'idle', error: error.message, next: null })
      if (error.status === 409) sample.retry()
    }
  }

  return (
    <div className="container page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        {amending ? <Link to="/reviews">Reviews</Link> : <Link to="/queue">Queue</Link>}
        <span aria-hidden="true">/</span>
        <Link to={`/samples/${id}`}>{id}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{amending ? 'Edit review' : 'Review'}</span>
      </nav>

      <header className="review__head">
        <h1 className="headline h1">Review {id}</h1>
        <OutcomeMark kind={decision} size="lg">
          {WORDS[decision]} · {confidentTiles(n)}
        </OutcomeMark>
        <p className="lead">
          The 12 tiles the detector ranked highest, out of {formatCount(tilesScored)}. Look for
          an oval egg with a spine at one end. Debris and fibres are the usual false alarms.
        </p>
      </header>

      <div className="review">
        <section aria-label="Top 12 tiles">
          <p className="muted review__legend">Counted tiles score above {threshold} and decide the outcome.</p>
          <div className="review__tiles">
            {topTiles.map((t) => (
              <TileCard key={t.rank} {...t} />
            ))}
          </div>
        </section>

        <div className="review__side">
          <EggGuide />
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
                    disabled={busy}
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
                maxLength={500}
                disabled={busy}
              />

              {amending && (
                <p className="decision__editing muted small">
                  Editing the review from {formatTime(current.createdAt)}. It stays in the history as an earlier
                  version.
                </p>
              )}
              <button type="submit" className="btn btn--primary decision__submit" disabled={!choice || busy}>
                {save.status === 'saving'
                  ? amending
                    ? 'Saving…'
                    : 'Recording…'
                  : amending
                    ? 'Save changes'
                    : 'Record decision'}
              </button>
              <p className="decision__status" role="status">
                {save.status === 'saved' &&
                  (save.next
                    ? `Decision recorded for ${id}. Opening ${save.next}.`
                    : `Decision recorded for ${id}. No referred samples left to review.`)}
              </p>
              {save.error && (
                <p className="decision__error" role="alert">
                  {save.error}
                </p>
              )}
              <p className="muted small">Decisions are logged for audit and not used to retrain the model.</p>
            </form>

            {!amending && (
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
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

// The next referred sample after this one that has not been reviewed yet.
function findNext(queue, id) {
  const referred = queue.filter((s) => s.decision === 'referred')
  const start = referred.findIndex((s) => s.id === id)
  for (let step = 1; step <= referred.length; step++) {
    const candidate = referred[(start + step) % referred.length]
    if (candidate.id !== id && isWaiting(candidate)) return candidate.id
  }
  return null
}
