import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { TILES_PER_IMAGE, getConfig, getSample, isReviewed } from '../api.js'
import { pending, useApi } from '../useApi.js'
import { formatCount, formatTime, tilesLookLikeEggs } from '../format.js'
import Button from '../components/Button.jsx'
import DecisionScale from '../components/DecisionScale.jsx'
import OutcomeMark from '../components/OutcomeMark.jsx'
import PageHeader from '../components/PageHeader.jsx'
import PageState from '../components/PageState.jsx'
import ReviewCodeGate from '../components/ReviewCodeGate.jsx'
import StatBlock from '../components/StatBlock.jsx'
import TileCard from '../components/TileCard.jsx'
import VerdictMark from '../components/VerdictMark.jsx'
import SampleNotFound from './SampleNotFound.jsx'
import './Result.css'

const SENTENCE = {
  negative: 'Negative, cleared automatically',
  referred: 'Referred to a technician',
  positive: 'Positive, confirmed automatically',
}

const SUBLINE = {
  negative: 'Cleared without review.',
  referred: 'Too many to clear, too few to confirm.',
  positive: 'Enough to confirm without review.',
}

// /samples/upload shows an upload's result, passed in router state; any other
// ID is a stored sample from the backend.
export default function Result() {
  const { id } = useParams()
  return id === 'upload' ? <UploadResult /> : <StoredResult id={id} />
}

function StoredResult({ id }) {
  const sample = useApi(getSample, id)
  const config = useApi(getConfig)

  const waiting = pending(sample, config)
  if (waiting) return <PageState {...waiting} />
  if (sample.data === null) return <SampleNotFound id={id} />
  return <ResultView sample={sample.data} config={config.data} />
}

function UploadResult() {
  const location = useLocation()
  const navigate = useNavigate()
  // Keep the result in memory only: clear it from the history entry, so a
  // reload (which keeps history state) finds nothing, as promised.
  const [result] = useState(() => location.state?.result ?? null)
  const config = useApi(getConfig)

  useEffect(() => {
    if (location.state?.result) navigate(location.pathname, { replace: true, state: null })
  }, [location.state, location.pathname, navigate])

  if (!result) {
    return (
      <div className="container page">
        <PageHeader
          title="This result is no longer available."
          summary="Uploaded images are never stored."
          actions={
            <Button to="/analyse" variant="link">
              Back to Analyse
            </Button>
          }
        />
      </div>
    )
  }
  if (config.data === undefined) return <PageState {...config} />
  return <ResultView sample={result} config={config.data} />
}

function ResultView({ sample, config }) {
  const upload = sample.source === 'upload'
  const { id, decision, confidentTiles: n, topTiles, highestTile, highestScore, tilesScored, tileThreshold } = sample
  const rule = config.settings[sample.setting] ?? config
  const name = upload ? 'Your sample' : id

  return (
    <div className="container page">
      <PageHeader
        breadcrumb={
          <nav className="breadcrumb" aria-label="Breadcrumb">
            {upload ? <Link to="/analyse">Analyse</Link> : <Link to="/queue">Queue</Link>}
            <span aria-hidden="true">/</span>
            <span aria-current="page">{upload ? 'Uploaded sample' : id}</span>
          </nav>
        }
        title={
          <>
            {n === 0 ? 'No tile looks like an egg.' : tilesLookLikeEggs(n)}{' '}
            <span className="soft">{SUBLINE[decision]}</span>
          </>
        }
        summary={
          <div className="result__summary">
            <OutcomeMark kind={decision}>{SENTENCE[decision]}</OutcomeMark>
            {upload && sample.seconds !== null && <span>Analysed in {sample.seconds.toFixed(1)} s</span>}
          </div>
        }
        actions={
          <>
            {!upload && decision === 'referred' && !isReviewed(sample) && (
              <Button to={`/review/${id}`} variant="outline">
                Open in review
              </Button>
            )}
            {upload ? (
              <Button to="/analyse" variant="link">
                Analyse another sample
              </Button>
            ) : (
              <Button to="/queue" variant="link">
                Back to queue
              </Button>
            )}
          </>
        }
      />
      {isReviewed(sample) && <ReviewerVerdict id={id} review={sample.review} count={sample.reviewCount} />}

      <section className="result__section" aria-labelledby="lands-title">
        <h2 className="section-title" id="lands-title">
          Where this sample lands
        </h2>
        <div className="result__scale">
          <DecisionScale id={name} count={n} flagAbove={rule.flagAbove} />
        </div>
      </section>

      <section className="result__stats" aria-label="Summary">
        <StatBlock label="Confident tiles" value={formatCount(n)} note={`score above ${tileThreshold}`} />
        <StatBlock
          label="Highest tile score"
          value={highestScore.toFixed(3)}
          note={`image ${highestTile.image}, tile ${highestTile.tile}`}
        />
        <StatBlock
          label="Tiles scored"
          value={formatCount(tilesScored)}
          note={`${formatCount(tilesScored / TILES_PER_IMAGE)} images × ${TILES_PER_IMAGE}`}
        />
        <StatBlock
          label="Setting"
          value={rule.label}
          note={
            <Link to="/performance" className="text-link">
              What this means
            </Link>
          }
        />
      </section>

      <section className="result__section" aria-labelledby="saw-title">
        <div className="result__section-head">
          <h2 className="section-title" id="saw-title">
            What the detector saw
          </h2>
          {!upload && decision === 'referred' && (
            <Button to={`/review/${id}`} variant="link">
              All 12 in review
            </Button>
          )}
        </div>
        <p className="muted result__note">
          Counted tiles score above {rule.tileThreshold ?? tileThreshold} and decide the outcome.
        </p>
        <div className="result__tiles">
          {topTiles.slice(0, 6).map((t) => (
            <TileCard
              key={t.rank}
              imageUrl={t.imageUrl}
              score={t.score}
              image={t.image}
              tile={t.tile}
              confident={t.confident}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

// The technician's current verdict: the latest version of this sample's review.
function ReviewerVerdict({ id, review, count }) {
  const word = review.verdict === 'infected' ? 'Infected' : 'Healthy'
  return (
    <div className="result__verdict">
      <p className="result__verdict-line">
        <VerdictMark verdict={review.verdict}>Reviewer verdict: {word}</VerdictMark>
        <time className="muted" dateTime={review.createdAt}>
          {formatTime(review.createdAt)}
        </time>
        {count > 1 && <span className="muted">{count} versions</span>}
        <Link to={`/review/${id}?edit=1`} className="text-link">
          Edit review
        </Link>
      </p>
      {review.detailsHidden ? <HiddenNote /> : review.note && <p className="result__verdict-note">{review.note}</p>}
    </div>
  )
}

// The server needs a review code to show notes. Entering it here keeps it for
// this tab, and the result reloads with the note.
function HiddenNote() {
  const [asking, setAsking] = useState(false)
  return (
    <div className="result__verdict-note">
      <p>
        Note hidden. Enter the review code to see it.{' '}
        {!asking && (
          <button type="button" className="result__code-link" onClick={() => setAsking(true)}>
            Enter code
          </button>
        )}
      </p>
      {asking && (
        <div className="result__code">
          <ReviewCodeGate>{null}</ReviewCodeGate>
        </div>
      )}
    </div>
  )
}
