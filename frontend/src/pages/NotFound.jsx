import Button from '../components/Button.jsx'
import PageHeader from '../components/PageHeader.jsx'

export default function NotFound() {
  return (
    <div className="container page">
      <PageHeader
        title="Page not found."
        summary="This address does not exist."
        actions={
          <Button to="/" variant="link">
            Back to start
          </Button>
        }
      />
    </div>
  )
}
