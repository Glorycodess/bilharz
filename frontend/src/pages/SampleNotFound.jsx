import { Link } from 'react-router-dom'
import Button from '../components/Button.jsx'
import PageHeader from '../components/PageHeader.jsx'

export default function SampleNotFound({ id }) {
  return (
    <div className="container page">
      <PageHeader
        breadcrumb={
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <Link to="/queue">Queue</Link>
          </nav>
        }
        title="Sample not found."
        summary={`There is no sample called ${id}.`}
        actions={
          <Button to="/queue" variant="link">
            Back to queue
          </Button>
        }
      />
    </div>
  )
}
