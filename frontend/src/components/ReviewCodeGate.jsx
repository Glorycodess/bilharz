import { useState, useSyncExternalStore } from 'react'
import { dataVersion, getConfig, hasReviewCode, reviewCodeError, setReviewCode, subscribe } from '../api.js'
import { useApi } from '../useApi.js'
import './ReviewCodeGate.css'

// Shows `children` once review requests can be made: straight away if the
// server doesn't ask for a review code, otherwise after the code is entered.
// The code is kept in memory by api.js, never stored.
// `header` is shown above the code form, so the page keeps its title.
export default function ReviewCodeGate({ children, header = null }) {
  useSyncExternalStore(subscribe, dataVersion) // re-check when the code is set or rejected
  const config = useApi(getConfig).data
  const [code, setCode] = useState('')

  if (!config) return null
  if (!config.reviewCodeRequired || hasReviewCode()) return children

  const problem = reviewCodeError()
  function onSubmit(event) {
    event.preventDefault()
    if (!code.trim()) return
    setReviewCode(code.trim())
    setCode('')
  }

  return (
    <>
      {header}
      <form className="review-code" onSubmit={onSubmit}>
        <label className="field-label" htmlFor="review-code">
          Review access code
        </label>
        <p className="muted small review-code__hint">
          Reviews on this server are protected. Enter the code you were given; it is kept only until you close or
          reload this tab.
        </p>
        <div className="review-code__row">
          <input
            id="review-code"
            className="input"
            type="password"
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? 'review-code-error' : undefined}
          />
          <button type="submit" className="btn btn--outline" disabled={!code.trim()}>
            Continue
          </button>
        </div>
        {problem && (
          <p className="review-code__error" id="review-code-error" role="alert">
            {problem}
          </p>
        )}
      </form>
    </>
  )
}
