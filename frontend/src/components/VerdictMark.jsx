import { VERDICT_WORDS } from '../format.js'
import OutcomeMark from './OutcomeMark.jsx'

// A reviewer's verdict: red dot for infected, green for healthy, always with the word.
export default function VerdictMark({ verdict, size, children }) {
  return (
    <OutcomeMark kind={verdict === 'infected' ? 'positive' : 'negative'} size={size}>
      {children ?? VERDICT_WORDS[verdict]}
    </OutcomeMark>
  )
}
