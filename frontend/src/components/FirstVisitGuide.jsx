import { Link } from 'react-router-dom'
import { hideGuide, useGuideHidden } from '../guide.js'
import OutcomeMark from './OutcomeMark.jsx'
import './FirstVisitGuide.css'

const OUTCOMES = [
  {
    kind: 'negative',
    word: 'Negative',
    text: 'No tile looks like an egg. The sample is cleared without review.',
  },
  {
    kind: 'referred',
    word: 'Referred',
    text: 'Some tiles look like eggs, but too few to be sure. A technician decides.',
  },
  {
    kind: 'positive',
    word: 'Positive',
    text: 'Many tiles look like eggs. The sample is confirmed without review.',
  },
]

// A short explanation for first-time visitors, until they hide it.
export default function FirstVisitGuide() {
  const hidden = useGuideHidden()
  if (hidden) return null

  return (
    <section className="container guide" aria-labelledby="guide-title">
      <div className="guide__panel">
        <div className="guide__head">
          <h2 className="guide__title" id="guide-title">
            New to Bilharz?
          </h2>
          <button type="button" className="btn btn--outline guide__hide" onClick={hideGuide}>
            Got it, hide this
          </button>
        </div>
        <p className="guide__lead">
          Bilharz cuts a sample&rsquo;s 117 microscope images into 1,404 tiles and counts the tiles that look like
          eggs. The count gives one of three results:
        </p>
        <ul className="guide__outcomes">
          {OUTCOMES.map((o) => (
            <li key={o.kind}>
              <OutcomeMark kind={o.kind}>{o.word}</OutcomeMark>
              <span className="guide__text">{o.text}</span>
            </li>
          ))}
        </ul>
        <p className="guide__review">
          <strong>How reviewing works.</strong> Referred samples wait in the{' '}
          <Link to="/queue" className="text-link">
            Queue
          </Link>
          . A technician with a reviewer account, approved by an admin, opens one, looks at its 12 highest-scoring
          tiles, and records it as infected or healthy under their name. A review can be edited later, and every
          version is kept. Results and the queue are open to everyone.
        </p>
        <p className="guide__note muted small">Results support screening and are not a diagnosis.</p>
      </div>
    </section>
  )
}
