import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { getMe, signIn, signOut } from '../api.js'
import { inFrame, safeNext } from '../frame.js'
import { useApi } from '../useApi.js'
import Button from '../components/Button.jsx'
import OpenInNewTab from '../components/OpenInNewTab.jsx'
import PageHeader from '../components/PageHeader.jsx'
import PasswordField from '../components/PasswordField.jsx'
import './Account.css'

export default function SignIn() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const me = useApi(getMe).data
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState({ busy: false, error: null })

  async function onSubmit(event) {
    event.preventDefault()
    if (status.busy) return
    setStatus({ busy: true, error: null })
    try {
      await signIn({ email, password })
      navigate(next, { replace: true })
    } catch (error) {
      // The password is cleared after a failed attempt; the email is kept.
      setPassword('')
      setStatus({ busy: false, error: error.message })
    }
  }

  return (
    <div className="container page account">
      <PageHeader title="Sign in" summary="For reviewers and admins. Results and the queue are open without signing in." />
      {inFrame() ? (
        <OpenInNewTab path={`/sign-in?next=${encodeURIComponent(next)}`} />
      ) : me ? (
        <div className="account__done">
          <p>
            You&rsquo;re signed in as <strong>{me.name}</strong>.
          </p>
          <div className="account__actions">
            <Button to={next}>Continue</Button>
            <Button variant="outline" onClick={() => signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      ) : (
        <>
          <form className="account__form" onSubmit={onSubmit}>
            <div className="account__field">
              <label className="field-label" htmlFor="signin-email">
                Email
              </label>
              <input
                id="signin-email"
                className="input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={status.busy}
              />
            </div>
            <PasswordField
              id="signin-password"
              label="Password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              disabled={status.busy}
            />
            {status.error && (
              <p className="account__error" role="alert">
                {status.error}
              </p>
            )}
            <div className="account__actions">
              <button type="submit" className="btn btn--primary" disabled={status.busy || !email || !password}>
                {status.busy ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          </form>
          <p className="muted account__switch">
            No account yet?{' '}
            <Link to={`/sign-up?next=${encodeURIComponent(next)}`} className="text-link">
              Create one
            </Link>
            . Forgot your password? Ask an admin for a reset link.
          </p>
        </>
      )}
    </div>
  )
}
