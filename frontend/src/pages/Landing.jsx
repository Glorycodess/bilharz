import { Link } from 'react-router-dom'
import { getPerformance } from '../api.js'
import { useApi } from '../useApi.js'
import Button from '../components/Button.jsx'
import Footer from '../components/Footer.jsx'
import OutcomeMark from '../components/OutcomeMark.jsx'
import TileGrid from '../components/TileGrid.jsx'
import './Landing.css'

const OUTCOMES = [
  { kind: 'negative', title: 'No tile looks like an egg.', text: 'Cleared automatically.' },
  { kind: 'referred', title: 'The evidence is in between.', text: 'Sent to a technician, with the tiles to check.' },
  { kind: 'positive', title: 'Many tiles clearly show eggs.', text: 'Confirmed automatically.' },
]

const STEPS = [
  { title: 'Cut', text: 'Each of the 117 images becomes 12 tiles, so an egg stays large enough to see.' },
  { title: 'Score', text: 'An egg detector scores all 1,404 tiles from 0 to 1.' },
  { title: 'Count', text: 'Only confident tiles are counted, so one false alarm no longer decides.' },
  { title: 'Decide', text: 'None: negative. Many: positive. In between: a technician decides.' },
]

export default function Landing() {
  const performance = useApi(getPerformance)

  return (
    <>
      <section className="container hero">
        <div className="hero__copy">
          <p className="eyebrow">Urine microscopy · schistosomiasis</p>
          <h1 className="headline h1--hero hero__title">
            The clear cases decide themselves. <span className="soft">The hard ones come to you.</span>
          </h1>
          <p className="lead">
            Bilharz reads the 117 microscope images of a urine sample, settles the samples it is sure about, and
            sends only the uncertain ones to a technician.
          </p>
          <div className="hero__actions">
            <Button to="/analyse">Analyse a sample</Button>
            <Button to="/performance" variant="link">
              See the evidence
            </Button>
          </div>
        </div>
        <figure className="hero__figure">
          <TileGrid count={1404} highlighted={[211, 503, 862, 1190]} />
          <figcaption className="hero__caption">
            One sample, 1,404 tiles. Four look like eggs. Too many to clear, too few to confirm: this one goes to a
            technician.
          </figcaption>
        </figure>
      </section>

      <section className="container" aria-label="Three outcomes">
        <ul className="outcomes">
          {OUTCOMES.map((o) => (
            <li key={o.kind} className="outcomes__item">
              <OutcomeMark kind={o.kind} />
              <h2 className="outcomes__title">{o.title}</h2>
              <p className="muted">{o.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="container problem" aria-labelledby="problem-label">
        <p className="eyebrow" id="problem-label">
          The problem
        </p>
        <div className="problem__body">
          <p className="problem__number number">
            48.9<span className="problem__pct">%</span>
          </p>
          <div className="problem__text">
            <p className="problem__lead">Specificity of fully automated screening, in a field study of 487 people.</p>
            <p className="muted">
              The microscope calls a patient positive if any one of 117 images shows an egg. A single piece of debris
              is enough, so about half of healthy people are told they are infected.
            </p>
            <p className="problem__source">Source: Meulah et al., 2022</p>
          </div>
        </div>
      </section>

      <section className="dark" aria-labelledby="dark-title">
        <div className="container">
          <h2 className="headline h2" id="dark-title">
            Same detector. A different decision.
          </h2>
          {performance && <DarkStats {...performance} />}
        </div>
      </section>

      <section className="container how" aria-labelledby="how-title">
        <h2 className="headline h2" id="how-title">
          How it decides
        </h2>
        <ol className="how__steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="how__step">
              <span className="how__num">{String(i + 1).padStart(2, '0')}</span>
              <h3 className="how__title">{s.title}</h3>
              <p className="muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="container closing">
        <h2 className="headline closing__title">Run a sample and see where it lands.</h2>
        <Button to="/analyse">Analyse a sample</Button>
      </section>

      <Footer />
    </>
  )
}

// The headline numbers: the Efficiency setting (main analysis), with a
// pointer to Safety, which the app runs on.
function DarkStats({ settings, anyTile }) {
  const stat = (key, name) => settings.find((s) => s.key === key).stats.find((s) => s.key === name)
  const caught = stat('efficiency', 'caught')
  const cleared = stat('efficiency', 'cleared')
  const reviewed = stat('efficiency', 'reviewed')
  const safetyReviewed = stat('safety', 'reviewed')

  return (
    <>
      <p className="eyebrow dark__eyebrow">Main analysis · Efficiency setting</p>
      <div className="dark__stats">
        <div className="dark__stat">
          <p className="dark__value number dark__value--grey">{anyTile.cleared}</p>
          <p className="dark__text">
            Specificity when any tile scoring above {anyTile.threshold} flags the patient. Every healthy sample had a
            false alarm.
          </p>
        </div>
        <div className="dark__stat">
          <p className="dark__value number">{cleared.value}</p>
          <p className="dark__text">
            Specificity with Bilharz triage, catching {caught.value} of infected patients.
          </p>
        </div>
        <div className="dark__stat">
          <p className="dark__value number dark__value--referred">{reviewed.value}</p>
          <p className="dark__text">Of samples reach a technician. The rest are decided automatically.</p>
        </div>
      </div>
      <p className="dark__note">
        Cross-validated on 65 patients from one dataset, every threshold learned on separate patients, referred samples
        assumed read correctly. 95% intervals: sensitivity {caught.interval}, specificity {cleared.interval}.
      </p>
      <p className="dark__note dark__note--follow">
        The app runs on the Safety setting by default: in testing it missed no infected patients, with{' '}
        {safetyReviewed.value} of samples reviewed.{' '}
        <Link to="/performance" className="dark__link">
          See Performance
        </Link>
        .
      </p>
    </>
  )
}
