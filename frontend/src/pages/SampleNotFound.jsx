import { Link } from 'react-router-dom'
import Button from '../components/Button.jsx'

export default function SampleNotFound({ id }) {
  return (
    <div className="container page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/queue">Queue</Link>
      </nav>
      <h1 className="headline h1">
        Sample not found. <span className="soft">There is no sample called {id}.</span>
      </h1>
      <div style={{ marginTop: 40 }}>
        <Button to="/queue" variant="link">
          Back to queue
        </Button>
      </div>
    </div>
  )
}
