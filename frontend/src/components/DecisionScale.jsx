import './DecisionScale.css'

// The three decision bands, drawn 1 : 35 : 14, with a marker at the
// sample's confident-tile count.
export default function DecisionScale({ id, count, flagAbove }) {
  const span = flagAbove + 15 // the positive band shows 14 counts past the cut-off
  const segments = [
    { kind: 'negative', from: 0, size: 1 },
    { kind: 'referred', from: 1, size: flagAbove },
    { kind: 'positive', from: flagAbove + 1, size: span - flagAbove - 1 },
  ]
  const index = count < 1 ? 0 : count <= flagAbove ? 1 : 2
  const position = Math.min(count + 0.5, span - 0.25) / span
  const align = position < 0.12 ? 'start' : position > 0.88 ? 'end' : 'center'

  return (
    <div className="scale">
      <div className="scale__marker-row">
        <div
          className={`scale__marker scale__marker--${align}`}
          style={{ left: `calc((100% - 8px) * ${position} + ${index * 4}px)` }}
        >
          <span className="scale__marker-label">
            {id} · {count}
          </span>
          <span className="scale__marker-tick" aria-hidden="true" />
        </div>
      </div>
      <div className="scale__bar" aria-hidden="true">
        {segments.map((s) => (
          <span key={s.kind} className={`scale__segment scale__segment--${s.kind}`} style={{ flexGrow: s.size }} />
        ))}
      </div>
      <div className="scale__labels">
        <span>0 confident tiles · negative</span>
        <span>1–{flagAbove} · referred</span>
        <span>{flagAbove + 1} or more · positive</span>
      </div>
    </div>
  )
}
