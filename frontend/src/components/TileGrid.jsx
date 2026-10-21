import './TileGrid.css'

// One sample's tiles as tiny squares, with the highlighted ones in orange.
export default function TileGrid({ count, highlighted, columns = 36 }) {
  const marked = new Set(highlighted)
  return (
    <div className="tile-grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={marked.has(i) ? 'tile-grid__cell tile-grid__cell--on' : 'tile-grid__cell'} />
      ))}
    </div>
  )
}
