import { useLocation } from 'react-router-dom'
import { getMe } from '../api.js'
import { inFrame } from '../frame.js'
import { useApi } from '../useApi.js'
import Button from './Button.jsx'
import OpenInNewTab from './OpenInNewTab.jsx'
import PageState from './PageState.jsx'
import './ReviewerGate.css'

// Shows `children` only to a signed-in, approved reviewer. Anyone else sees why
// not and what to do: sign in (in a new tab inside the Hugging Face page), or
// wait for an admin to approve the account. The server checks the same rule
// on every request; this only explains it.
// `header` is shown above the message, so the page keeps its title.
export default function ReviewerGate({ children, header = null, purpose = 'review samples' }) {
  const me = useApi(getMe)
  const { pathname, search } = useLocation()

  if (me.data === undefined) return me.error ? <PageState {...me} /> : null
  const account = me.data
  if (account?.canReview) return children

  const next = encodeURIComponent(pathname + search)
  return (
    <>
      {header}
      <section className="gate" aria-labelledby="gate-title">
        {account ? (
          <>
            <h2 className="gate__title" id="gate-title">
              Waiting for approval
            </h2>
            <p className="gate__text">
              You&rsquo;re signed in as {account.name}. An admin has to approve your account before you can {purpose}.
              Results and the queue stay open to you in the meantime.
            </p>
          </>
        ) : (
          <>
            <h2 className="gate__title" id="gate-title">
              Sign in to {purpose}
            </h2>
            {inFrame() ? (
              <OpenInNewTab path={`/sign-in?next=${next}`} />
            ) : (
              <>
                <p className="gate__text">
                  Reviewing needs a reviewer account that an admin has approved. Results and the queue are open to
                  everyone.
                </p>
                <div className="gate__actions">
                  <Button to={`/sign-in?next=${next}`}>Sign in</Button>
                  <Button to={`/sign-up?next=${next}`} variant="outline">
                    Create an account
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </section>
    </>
  )
}
