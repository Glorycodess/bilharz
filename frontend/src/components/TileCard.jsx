import { useState } from 'react'
import './TileCard.css'

// One tile: its image (or a placeholder), with the score and position below.
export default function TileCard({ imageUrl, score, image, tile, confident = false, rank }) {
  const [failed, setFailed] = useState(false)
  const hasData = score !== undefined
  const showImage = imageUrl && !failed
  return (
    <figure className="tile-card">
      <div className={`tile-card__image${confident ? ' tile-card__image--confident' : ''}`}>
        {showImage ? (
          <img
            src={imageUrl}
            alt={`Tile ${tile} of image ${image}${hasData ? `, score ${score.toFixed(3)}` : ''}`}
            width="256"
            height="256"
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="tile-card__label">Tile image</span>
        )}
        {rank !== undefined && <span className="tile-card__rank">{rank}</span>}
        {confident && <span className="tile-card__counted">Counted</span>}
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
