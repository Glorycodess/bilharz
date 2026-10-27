import OutcomeMark from './OutcomeMark.jsx'

const WORDS = { infected: 'Infected', healthy: 'Healthy' }

// A reviewer's verdict: red dot for infected, green for healthy, always with the word.
export default function VerdictMark({ verdict, size, children }) {
  return (
    <OutcomeMark kind={verdict === 'infected' ? 'positive' : 'negative'} size={size}>
      {children ?? WORDS[verdict]}
    </OutcomeMark>
  )
}
