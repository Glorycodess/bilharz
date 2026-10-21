import Button from '../components/Button.jsx'

export default function NotFound() {
  return (
    <div className="container page">
      <h1 className="headline h1">
        Page not found. <span className="soft">This address does not exist.</span>
      </h1>
      <div style={{ marginTop: 40 }}>
        <Button to="/" variant="link">
          Back to start
        </Button>
      </div>
    </div>
  )
}
