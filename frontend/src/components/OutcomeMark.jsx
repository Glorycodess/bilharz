import './OutcomeMark.css'

const WORDS = { negative: 'Negative', referred: 'Referred', positive: 'Positive' }

// Dot plus word, so the outcome never depends on colour alone.
export default function OutcomeMark({ kind, children, size = 'md' }) {
  return (
    <span className={`outcome outcome--${size}`}>
      <span className={`outcome__mark outcome__mark--${kind}`} aria-hidden="true" />
      <span>{children ?? WORDS[kind]}</span>
    </span>
  )
}
