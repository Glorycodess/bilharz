import { useState } from 'react'
import {
  approveAccount,
  claimAdmin,
  disableAccount,
  getAccounts,
  getMe,
  makeResetLink,
  setAccountRole,
} from '../api.js'
import { formatFull, formatTime } from '../format.js'
import { inFrame } from '../frame.js'
import { pending, useApi } from '../useApi.js'
import Button from '../components/Button.jsx'
import OpenInNewTab from '../components/OpenInNewTab.jsx'
import PageHeader from '../components/PageHeader.jsx'
import PageState from '../components/PageState.jsx'
import './Account.css'
import './Queue.css'
import './Admin.css'

const STATUS_WORDS = { pending: 'Waiting for approval', approved: 'Approved', disabled: 'Disabled' }
const ROLE_WORDS = { reviewer: 'Reviewer', admin: 'Admin' }

// Accounts: approve, disable, change role, make a reset link. Only an admin
// sees the list; the server refuses every one of these actions to anyone else.
export default function Admin() {
  const me = useApi(getMe)
  if (me.data === undefined) return <PageState {...me} />
  const account = me.data

  return (
    <div className="container page">
      {!account ? (
        <>
          <PageHeader title="Admin" summary="Approve reviewers and manage accounts." />
          {inFrame() ? (
            <OpenInNewTab path="/sign-in?next=%2Fadmin" />
          ) : (
            <div className="account__actions">
              <Button to="/sign-in?next=%2Fadmin">Sign in</Button>
            </div>
          )}
        </>
      ) : account.isAdmin ? (
        <Accounts me={account} />
      ) : (
        <ClaimAdmin account={account} />
      )}
    </div>
  )
}

// The admin token makes the signed-in account an admin: the first admin, or a
// way back in. It is sent once and not kept.
function ClaimAdmin({ account }) {
  const [token, setToken] = useState('')
  const [status, setStatus] = useState({ busy: false, error: null })

  async function onSubmit(event) {
    event.preventDefault()
    if (!token || status.busy) return
    setStatus({ busy: true, error: null })
    const sending = token
    setToken('')
    try {
      await claimAdmin(sending)
    } catch (error) {
      setStatus({ busy: false, error: error.message })
    }
  }

  return (
    <div className="account">
      <PageHeader title="Admin" summary={`Signed in as ${account.name}. This account is not an admin.`} />
      <p>
        Admins approve reviewers. The project owner makes the first admin with the admin token, a secret set on the
        server. If you hold it, enter it to make this account an admin.
      </p>
      <form className="account__form" onSubmit={onSubmit}>
        <div className="account__field">
          <label className="field-label" htmlFor="claim-token">
            Admin token
          </label>
          <input
            id="claim-token"
            className="input"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={status.busy}
            aria-describedby="claim-token-hint"
          />
          <p className="muted small account__hint" id="claim-token-hint">
            Used for this request only and not saved. Five wrong tokens lock this for 15 minutes.
          </p>
        </div>
        {status.error && (
          <p className="account__error" role="alert">
            {status.error}
          </p>
        )}
        <div className="account__actions">
          <button type="submit" className="btn btn--primary" disabled={!token || status.busy}>
            {status.busy ? 'Checking…' : 'Make me an admin'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Accounts({ me }) {
  const accounts = useApi(getAccounts)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [link, setLink] = useState(null)

  const waiting = pending(accounts)
  if (waiting) return <PageState {...waiting} />
  const list = accounts.data
  const waitingCount = list.filter((a) => a.status === 'pending').length

  async function act(account, label, call) {
    setBusy(`${account.id}:${label}`)
    setError(null)
    try {
      return await call()
    } catch (e) {
      setError(`${account.name}: ${e.message}`)
      return null
    } finally {
      setBusy(null)
    }
  }

  async function onResetLink(account) {
    const made = await act(account, 'reset', () => makeResetLink(account.id))
    if (made) setLink({ ...made, name: account.name })
  }

  return (
    <>
      <PageHeader
        title="Admin"
        summary={`${list.length} ${list.length === 1 ? 'account' : 'accounts'} · ${waitingCount} waiting for approval`}
      />
      {error && (
        <p className="account__error admin__error" role="alert">
          {error}
        </p>
      )}
      {link && <ResetLinkPanel link={link} onDone={() => setLink(null)} />}

      <div className="queue__table-wrap" tabIndex={0} role="region" aria-label="Accounts">
        <table className="queue__table admin__table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Status</th>
              <th scope="col">Created</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((a) => {
              const self = a.id === me.id
              const working = (label) => busy === `${a.id}:${label}`
              return (
                <tr key={a.id} className={a.status === 'pending' ? 'admin__row--pending' : undefined}>
                  <th scope="row">
                    {a.name}
                    {self && <span className="muted"> (you)</span>}
                  </th>
                  <td className="admin__email">{a.email}</td>
                  <td>{ROLE_WORDS[a.role]}</td>
                  <td>
                    <span className={`admin__status admin__status--${a.status}`}>{STATUS_WORDS[a.status]}</span>
                  </td>
                  <td>
                    <time dateTime={a.createdAt} title={formatFull(a.createdAt)}>
                      {formatTime(a.createdAt)}
                    </time>
                  </td>
                  <td className="admin__actions-cell">
                    <div className="admin__actions">
                      {a.status !== 'approved' && (
                        <button
                          type="button"
                          className="btn btn--primary admin__button"
                          disabled={busy !== null}
                          onClick={() => act(a, 'approve', () => approveAccount(a.id))}
                          aria-label={`Approve ${a.name}`}
                        >
                          {working('approve') ? 'Approving…' : 'Approve'}
                        </button>
                      )}
                      {!self && a.status === 'approved' && (
                        <button
                          type="button"
                          className="btn btn--outline admin__button"
                          disabled={busy !== null}
                          onClick={() => act(a, 'role', () => setAccountRole(a.id, a.role === 'admin' ? 'reviewer' : 'admin'))}
                          aria-label={a.role === 'admin' ? `Make ${a.name} a reviewer` : `Make ${a.name} an admin`}
                        >
                          {a.role === 'admin' ? 'Make reviewer' : 'Make admin'}
                        </button>
                      )}
                      {a.status !== 'disabled' && (
                        <button
                          type="button"
                          className="btn btn--outline admin__button"
                          disabled={busy !== null}
                          onClick={() => onResetLink(a)}
                          aria-label={`Make a reset link for ${a.name}`}
                        >
                          {working('reset') ? 'Making…' : 'Reset link'}
                        </button>
                      )}
                      {!self && a.status !== 'disabled' && (
                        <button
                          type="button"
                          className="btn btn--outline admin__button admin__button--danger"
                          disabled={busy !== null}
                          onClick={() => act(a, 'disable', () => disableAccount(a.id))}
                          aria-label={`Disable ${a.name}`}
                        >
                          {working('disable') ? 'Disabling…' : 'Disable'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small admin__note">
        Disabling signs the account out everywhere; its reviews stay, under its name. Approving it again lets it back in.
        You can&rsquo;t disable your own account or remove your own admin role.
      </p>
    </>
  )
}

// A reset link is shown once, here, and kept nowhere else in the browser.
function ResetLinkPanel({ link, onDone }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="admin__link" aria-labelledby="reset-link-title">
      <h2 className="admin__link-title" id="reset-link-title">
        Reset link for {link.name}
      </h2>
      <p className="small">
        Give it to {link.name} yourself, privately: anyone who has it can set the password. It works once, until{' '}
        {formatTime(link.expiresAt)}. Bilharz sends no email.
      </p>
      <div className="admin__link-row">
        <input
          className="input"
          readOnly
          value={link.url}
          aria-label={`Reset link for ${link.name}`}
          onFocus={(e) => e.target.select()}
        />
        <button type="button" className="btn btn--outline" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="btn btn--link" onClick={onDone}>
          Done
        </button>
      </div>
    </section>
  )
}
