import { Link, useLocation } from 'react-router-dom'
import { getConfig, getQueue } from '../api.js'
import { useApi } from '../useApi.js'
import { countWaiting, useReviews } from '../reviews.js'
import Logo from './Logo.jsx'
import { ChartIcon, CloseIcon, HomeIcon, ListIcon, PanelIcon, UploadIcon } from './Icons.jsx'
import './Sidebar.css'

const NAV = [
  { to: '/', label: 'Home', Icon: HomeIcon, match: ['/'] },
  { to: '/analyse', label: 'Analyse', Icon: UploadIcon, match: ['/analyse'] },
  { to: '/queue', label: 'Queue', Icon: ListIcon, match: ['/queue', '/samples', '/review'], badge: true },
  { to: '/performance', label: 'Performance', Icon: ChartIcon, match: ['/performance'] },
]

// On small screens this is a drawer: `drawer` is true, and `onClose`
// is called by the close button and by any link inside it. On wider
// screens it can collapse to an icon rail: `rail` is true.
export default function Sidebar({ id, drawer, open, onClose, closeRef, rail, onToggleRail }) {
  const { pathname } = useLocation()
  const queue = useApi(getQueue)
  const config = useApi(getConfig)
  const { reviews } = useReviews()
  const waiting = queue ? countWaiting(queue, reviews) : null

  function onClick(event) {
    if (drawer && event.target.closest('a')) onClose()
  }

  return (
    <aside
      id={id}
      className={`sidebar${open ? ' sidebar--open' : ''}${rail ? ' sidebar--rail' : ''}`}
      aria-label={drawer ? 'Menu' : undefined}
      role={drawer ? 'dialog' : undefined}
      aria-modal={drawer ? true : undefined}
      inert={drawer && !open}
      onClick={onClick}
    >
      <div className="sidebar__top">
        <Logo />
        {drawer ? (
          <button ref={closeRef} type="button" className="sidebar__close" aria-label="Close menu" onClick={onClose}>
            <CloseIcon />
          </button>
        ) : (
          <button
            type="button"
            className="sidebar__toggle"
            aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!rail}
            aria-controls={id}
            aria-keyshortcuts="["
            onClick={onToggleRail}
          >
            <PanelIcon />
          </button>
        )}
      </div>

      <nav aria-label="App">
        <ul className="sidebar__nav">
          {NAV.map(({ to, label, Icon, match, badge }) => {
            const active = match.some((p) => pathname === p || pathname.startsWith(`${p}/`))
            const name = badge && waiting ? `${label}, ${waiting} waiting for review` : label
            return (
              <li key={to}>
                <Link
                  to={to}
                  className={`sidebar__link${active ? ' sidebar__link--active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  aria-label={rail ? name : undefined}
                  data-tooltip={rail ? label : undefined}
                >
                  <Icon className="sidebar__icon" />
                  <span className="sidebar__label">{label}</span>
                  {badge && waiting !== null && (
                    <span className={`sidebar__badge${waiting === 0 ? ' sidebar__badge--empty' : ''}`}>
                      {waiting}
                      <span className="visually-hidden"> waiting for review</span>
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="sidebar__setting">
        <p className="sidebar__setting-label">Decision setting</p>
        <p className="sidebar__setting-value">
          <span className="strong">{config?.setting ?? 'Safety'}</span>
          <Link to="/performance" className="text-link sidebar__change">
            Change
          </Link>
        </p>
      </div>

      <div className="sidebar__bottom">
        <p className="sidebar__disclaimer">Research prototype. Not a medical device.</p>
      </div>
    </aside>
  )
}
