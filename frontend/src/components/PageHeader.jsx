import './PageHeader.css'

// The top of every app page: an optional breadcrumb, the title with a summary
// line under it, and the page's actions on the right of the same row.
export default function PageHeader({ breadcrumb, title, summary, actions }) {
  return (
    <header className="page-header">
      {breadcrumb}
      <div className="page-header__row">
        <div className="page-header__text">
          <h1 className="page-header__title">{title}</h1>
          {summary && <div className="page-header__summary">{summary}</div>}
        </div>
        {actions && <div className="page-header__actions">{actions}</div>}
      </div>
    </header>
  )
}
