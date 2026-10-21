import './StatBlock.css'

export default function StatBlock({ label, value, note, tone, signal = false }) {
  return (
    <div className="stat">
      <p className="stat__label">
        {signal && <span className="stat__dot" aria-hidden="true" />}
        {label}
      </p>
      <p className={`stat__value number${tone ? ` stat__value--${tone}` : ''}`}>{value}</p>
      {note && <div className="stat__note">{note}</div>}
    </div>
  )
}
