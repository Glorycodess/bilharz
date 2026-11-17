import './OpenInNewTab.css'

// Inside the huggingface.co page, signing in cannot work (see frame.js), so
// this offers Bilharz in its own tab, at the same page.
export default function OpenInNewTab({ path, children = 'Open Bilharz in a new tab' }) {
  const href = new URL(path ?? window.location.pathname + window.location.search, window.location.origin).href
  return (
    <div className="new-tab">
      <p className="new-tab__text">
        Bilharz is shown inside another page here, and browsers don&rsquo;t keep a sign-in inside another site&rsquo;s
        page. Sign in with Bilharz open in its own tab.
      </p>
      <a className="btn btn--primary" href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    </div>
  )
}
