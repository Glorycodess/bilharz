import { useEffect, useState } from 'react'
import { resetPassword } from '../api.js'
import { inFrame } from '../frame.js'
import Button from '../components/Button.jsx'
import OpenInNewTab from '../components/OpenInNewTab.jsx'
import PageHeader from '../components/PageHeader.jsx'
import PasswordField from '../components/PasswordField.jsx'
import { MIN_PASSWORD } from './SignUp.jsx'
import './Account.css'

// The token is in the link after "#token=": the part of an address a browser
// never sends to a server. It is read once, then removed from the address bar
// and the history, so it is not left behind on a shared computer.
function readToken() {
  const match = window.location.hash.match(/^#token=([A-Za-z0-9_-]+)$/)
  return match ? match[1] : null
}

function forgetToken() {
  if (window.location.hash) {
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  }
}

export default function ResetPassword() {
  const framed = inFrame()
  // Inside another page the link is passed on, whole, to a new tab instead.
  const [token] = useState(() => (framed ? null : readToken()))
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState({ busy: false, error: null, done: false })

  useEffect(() => {
    if (!framed) forgetToken()
  }, [framed])

  async function onSubmit(event) {
    event.preventDefault()
    if (status.busy) return
    if (password.length < MIN_PASSWORD) {
      setStatus({ busy: false, error: `Use at least ${MIN_PASSWORD} characters.`, done: false })
      return
    }
    setStatus({ busy: true, error: null, done: false })
    try {
      await resetPassword({ token, password })
      setPassword('')
      setStatus({ busy: false, error: null, done: true })
    } catch (error) {
      setStatus({ busy: false, error: error.message, done: false })
    }
  }

  return (
    <div className="container page account">
      <PageHeader title="Set a new password" summary="With the one-time link an admin gave you. It works once, for an hour." />
      {framed ? (
        <OpenInNewTab path={`/reset-password${window.location.hash}`} />
      ) : status.done ? (
        <div className="account__done" role="status">
          <p>
            <strong>Your password is changed.</strong> You were signed out everywhere; sign in with the new one.
          </p>
          <div className="account__actions">
            <Button to="/sign-in">Sign in</Button>
          </div>
        </div>
      ) : !token ? (
        <div className="account__done" role="alert">
          <p>This page needs the reset link from an admin. Open the whole link you were given, or ask for a new one.</p>
        </div>
      ) : (
        <form className="account__form" onSubmit={onSubmit}>
          <PasswordField
            id="reset-password"
            label="New password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            hint={`At least ${MIN_PASSWORD} characters.`}
            disabled={status.busy}
          />
          {status.error && (
            <p className="account__error" role="alert">
              {status.error}
            </p>
          )}
          <div className="account__actions">
            <button type="submit" className="btn btn--primary" disabled={status.busy || !password}>
              {status.busy ? 'Saving…' : 'Set password'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
