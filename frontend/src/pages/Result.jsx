import { Link, useParams } from 'react-router-dom'
import { getConfig, getSample } from '../api.js'
import { useApi } from '../useApi.js'
import { formatCount, tilesLookLikeEggs } from '../format.js'
import Button from '../components/Button.jsx'
import DecisionScale from '../components/DecisionScale.jsx'
import OutcomeMark from '../components/OutcomeMark.jsx'
import StatBlock from '../components/StatBlock.jsx'
import TileCard from '../components/TileCard.jsx'
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

export default function Result() {
  const { id } = useParams()
  const sample = useApi(getSample, id)
  const config = useApi(getConfig)

  if (sample === undefined || config === undefined) return <div className="container page" aria-busy="true" />
  if (sample === null) return <SampleNotFound id={id} />

  const { decision, confidentTiles: n, topTiles, highestTile } = sample
  const tiles = topTiles ? topTiles.slice(0, 6) : Array.from({ length: 6 }, () => null)

  return (
    <div className="container page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/queue">Queue</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{id}</span>
      </nav>

      <OutcomeMark kind={decision} size="lg">
        {SENTENCE[decision]}
      </OutcomeMark>
      <h1 className="headline h1--hero result__title">
        {n === 0 ? 'No tile looks like an egg.' : tilesLookLikeEggs(n)}{' '}
        <span className="soft">{SUBLINE[decision]}</span>
      </h1>
      <div className="result__actions">
        {decision === 'referred' && <Button to={`/review/${id}`}>Open in review</Button>}
        <Button to="/queue" variant="link">
          Back to queue
        </Button>
      </div>

      <section className="result__section" aria-labelledby="lands-title">
        <h2 className="section-title" id="lands-title">
          Where this sample lands
        </h2>
        <div className="result__scale">
          <DecisionScale id={id} count={n} flagAbove={config.flagAbove} />
        </div>
      </section>

      <section className="result__stats" aria-label="Summary">
        <StatBlock label="Confident tiles" value={formatCount(n)} note={`score above ${config.tileThreshold}`} />
        <StatBlock
          label="Highest tile score"
          value={highestTile ? highestTile.score.toFixed(3) : '—'}
          note={
            highestTile
              ? `image ${highestTile.image}, tile ${highestTile.tile}`
              : 'available once the backend is connected'
          }
        />
        <StatBlock
          label="Tiles scored"
          value={formatCount(config.tilesPerSample)}
          note={`${config.imagesPerSample} images × ${config.tilesPerImage}`}
        />
        <StatBlock
          label="Setting"
          value={config.setting}
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
          {decision === 'referred' && (
            <Button to={`/review/${id}`} variant="link">
              All 12 in review
            </Button>
          )}
        </div>
        <p className="muted result__note">
          {topTiles
            ? `Outlined tiles score above ${config.tileThreshold} and count towards the decision.`
            : 'Tile scores available once the backend is connected.'}
        </p>
        <div className="result__tiles">
          {tiles.map((t, i) =>
            t ? (
              <TileCard key={i} {...t} confident={t.score > config.tileThreshold} />
            ) : (
              <TileCard key={i} />
            ),
          )}
        </div>
      </section>
    </div>
  )
}
