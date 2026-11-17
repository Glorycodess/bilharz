import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { signUp } from '../api.js'
import { inFrame, safeNext } from '../frame.js'
import Button from '../components/Button.jsx'
import OpenInNewTab from '../components/OpenInNewTab.jsx'
import PageHeader from '../components/PageHeader.jsx'
import PasswordField from '../components/PasswordField.jsx'
import './Account.css'

export const MIN_PASSWORD = 12

export default function SignUp() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState({ busy: false, error: null, created: null })

  async function onSubmit(event) {
    event.preventDefault()
    if (status.busy) return
    if (password.length < MIN_PASSWORD) {
      setStatus({ busy: false, error: `Use at least ${MIN_PASSWORD} characters for the password.`, created: null })
      return
    }
    setStatus({ busy: true, error: null, created: null })
    try {
      const account = await signUp({ name, email, password })
      setPassword('')
      setStatus({ busy: false, error: null, created: account })
    } catch (error) {
      setStatus({ busy: false, error: error.message, created: null })
    }
  }

  return (
    <div className="container page account">
      <PageHeader
        title="Create a reviewer account"
        summary="An admin approves each account before it can review. Your name is shown with the reviews you record."
      />
      {inFrame() ? (
        <OpenInNewTab path={`/sign-up?next=${encodeURIComponent(next)}`} />
      ) : status.created ? (
        <div className="account__done" role="status">
          <p>
            <strong>Account created.</strong> You&rsquo;re signed in as {status.created.name}.
          </p>
          <p>An admin has to approve your account before you can review. Until then, results and the queue are open.</p>
          <div className="account__actions">
            <Button to={next} variant="outline">
              Continue
            </Button>
          </div>
        </div>
      ) : (
        <>
          <form className="account__form" onSubmit={onSubmit}>
            <div className="account__field">
              <label className="field-label" htmlFor="signup-name">
                Name
              </label>
              <input
                id="signup-name"
                className="input"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                required
                disabled={status.busy}
                aria-describedby="signup-name-hint"
              />
              <p className="muted small account__hint" id="signup-name-hint">
                As colleagues know you: it appears next to your reviews.
              </p>
            </div>
            <div className="account__field">
              <label className="field-label" htmlFor="signup-email">
                Email
              </label>
              <input
                id="signup-email"
                className="input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={254}
                required
                disabled={status.busy}
                aria-describedby="signup-email-hint"
              />
              <p className="muted small account__hint" id="signup-email-hint">
                You sign in with it. Bilharz sends no email and only admins can see it.
              </p>
            </div>
            <PasswordField
              id="signup-password"
              label="Password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              hint={`At least ${MIN_PASSWORD} characters. A few unrelated words make a strong one.`}
              disabled={status.busy}
            />
            {status.error && (
              <p className="account__error" role="alert">
                {status.error}
              </p>
            )}
            <div className="account__actions">
              <button
                type="submit"
                className="btn btn--primary"
                disabled={status.busy || !name.trim() || !email || !password}
              >
                {status.busy ? 'Creating…' : 'Create account'}
              </button>
            </div>
          </form>
          <p className="muted account__switch">
            Already have an account?{' '}
            <Link to={`/sign-in?next=${encodeURIComponent(next)}`} className="text-link">
              Sign in
            </Link>
            .
          </p>
        </>
      )}
    </div>
  )
}
