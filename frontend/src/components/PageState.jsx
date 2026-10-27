import Button from './Button.jsx'
import './PageState.css'

// What a page shows before its data is ready: quiet skeleton lines while
// loading, or a message with "Try again" if the request failed.
export default function PageState({ error, retry, retrying }) {
  if (!error) {
    return (
      <div className="container page" aria-busy="true">
        <div className="page-state__skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="page-state__loading" role="status">
          Loading…
        </p>
      </div>
    )
  }
  return (
    <div className="container page">
      <div className="page-state__error" role="alert">
        <p className="page-state__message">{error.message}</p>
        {retrying && <p className="muted small">Trying again automatically in a few seconds.</p>}
        <Button variant="outline" onClick={retry}>
          Try again
        </Button>
      </div>
    </div>
  )
}
