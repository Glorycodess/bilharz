import './TileCard.css'

// A placeholder square for one tile. Without a score it shows no caption.
export default function TileCard({ score, image, tile, confident = false, rank }) {
  const hasData = score !== undefined
  return (
    <figure className="tile-card">
      <div className={`tile-card__image${confident ? ' tile-card__image--confident' : ''}`}>
        {rank !== undefined && <span className="tile-card__rank">{rank}</span>}
        <span className="tile-card__label">Tile image</span>
        {confident && <span className="visually-hidden">, confident tile</span>}
      </div>
      {hasData && (
        <figcaption className="tile-card__caption">
          <span className="tile-card__score">{score.toFixed(3)}</span>
          <span className="tile-card__name">
            {image} · {tile}
          </span>
        </figcaption>
      )}
    </figure>
  )
}
