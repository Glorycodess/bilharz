import { useRef, useState } from 'react'
import { downloadReviewsCsv } from '../api.js'
import { DownloadIcon } from './Icons.jsx'
import './ExportDialog.css'

// "Export CSV": asks for the admin token, downloads the file, then forgets the
// token. It is never written to storage or cookies.
export default function ExportDialog() {
  const dialog = useRef(null)
  const [token, setToken] = useState('')
  const [status, setStatus] = useState({ busy: false, error: null })

  function close() {
    setToken('')
    setStatus({ busy: false, error: null })
    dialog.current?.close()
  }

  async function onSubmit(event) {
    event.preventDefault()
    if (!token || status.busy) return
    setStatus({ busy: true, error: null })
    const sending = token
    setToken('')
    try {
      await downloadReviewsCsv(sending)
      close()
    } catch (error) {
      setStatus({ busy: false, error: error.message })
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn--outline export__button"
        title="Downloads all reviews and their history"
        onClick={() => dialog.current?.showModal()}
      >
        <DownloadIcon className="export__icon" />
        Export CSV
      </button>
      <dialog ref={dialog} className="export" aria-labelledby="export-title" onClose={close}>
        <form onSubmit={onSubmit}>
          <h2 className="export__title" id="export-title">
            Export reviews
          </h2>
          <p className="muted small export__text">
            Downloads every review and its earlier versions as a CSV file. The admin token is used for this download
            only and is not saved.
          </p>
          <label className="field-label" htmlFor="admin-token">
            Admin token
          </label>
          <input
            id="admin-token"
            className="input export__input"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            aria-invalid={status.error ? true : undefined}
            aria-describedby={status.error ? 'export-error' : undefined}
            disabled={status.busy}
          />
          {status.error && (
            <p className="export__error" id="export-error" role="alert">
              {status.error}
            </p>
          )}
          <div className="export__actions">
            <button type="button" className="btn btn--outline" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary export__download" disabled={!token || status.busy}>
              {status.busy ? 'Downloading…' : 'Download'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}
