import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { countWaiting, getConfig, getMe, getQueue, signOut } from '../api.js'
import { useApi } from '../useApi.js'
import Logo from './Logo.jsx'
import {
  ChartIcon,
  ClipboardCheckIcon,
  CloseIcon,
  HomeIcon,
  ListIcon,
  MenuIcon,
  ShieldIcon,
  UploadIcon,
  UsersIcon,
} from './Icons.jsx'
import './Header.css'

const NAV = [
  { to: '/', label: 'Home', Icon: HomeIcon, match: ['/'] },
  { to: '/analyse', label: 'Analyse', Icon: UploadIcon, match: ['/analyse'] },
  { to: '/queue', label: 'Queue', Icon: ListIcon, match: ['/queue', '/samples', '/review'], badge: true },
  { to: '/reviews', label: 'Reviews', Icon: ClipboardCheckIcon, match: ['/reviews'] },
  { to: '/performance', label: 'Performance', Icon: ChartIcon, match: ['/performance'] },
  { to: '/privacy', label: 'Privacy', Icon: ShieldIcon, match: ['/privacy'] },
]
// Shown to admins only. The server refuses admin actions to anyone else.
const ADMIN_NAV = { to: '/admin', label: 'Admin', Icon: UsersIcon, match: ['/admin'] }

const FOCUSABLE = 'a[href], button:not([disabled])'

// Sticky top bar. The menu button opens the navigation sidebar over the page.
export default function Header() {
  const { pathname } = useLocation()
  const queue = useApi(getQueue).data
  const config = useApi(getConfig).data
  const account = useApi(getMe).data ?? null
  const waiting = queue ? countWaiting(queue) : null
  const nav = account?.isAdmin ? [...NAV, ADMIN_NAV] : NAV

  const [open, setOpen] = useState(false)
  const [openedOn, setOpenedOn] = useState(pathname)
  const trigger = useRef(null)
  const panel = useRef(null)
  const wasOpen = useRef(false)

  // Close when the route changes, including back and forward.
  if (open && openedOn !== pathname) setOpen(false)

  function openPanel() {
    setOpenedOn(pathname)
    setOpen(true)
  }

  useEffect(() => {
    if (open) {
      wasOpen.current = true
      panel.current?.querySelector('nav a')?.focus()
      const onKey = (e) => {
        if (e.key === 'Escape') setOpen(false)
      }
      document.addEventListener('keydown', onKey)
      document.body.style.overflow = 'hidden'
      return () => {
        document.removeEventListener('keydown', onKey)
        document.body.style.overflow = ''
      }
    }
    if (wasOpen.current) {
      wasOpen.current = false
      trigger.current?.focus()
    }
  }, [open])

  // Keep Tab cycling inside the open sidebar.
  function onPanelKeyDown(event) {
    if (event.key !== 'Tab') return
    const items = [...panel.current.querySelectorAll(FOCUSABLE)]
    const first = items[0]
    const last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <>
      <header className="header" inert={open}>
        <div className="header__inner">
          <div className="header__start">
            <button
              ref={trigger}
              type="button"
              className="header__toggle"
              aria-label="Open navigation"
              aria-expanded={open}
              aria-controls="app-sidebar"
              onClick={openPanel}
            >
              <MenuIcon />
            </button>
            <Link to="/" className="header__logo" aria-label="Bilharz, home">
              <Logo />
            </Link>
          </div>

          <div className="header__actions">
            {waiting !== null && (
              <Link to="/queue" className="header__waiting">
                <span className="header__waiting-dot" aria-hidden="true" />
                {waiting} waiting for review
              </Link>
            )}
            <Link to="/analyse" className="btn btn--primary header__cta" aria-label="Analyse a sample">
              <UploadIcon className="header__cta-icon" />
              <span className="header__cta-label">Analyse a sample</span>
            </Link>
          </div>
        </div>
      </header>

      <div className={`sidebar-backdrop${open ? ' is-open' : ''}`} aria-hidden="true" onClick={() => setOpen(false)} />

      <aside
        ref={panel}
        id="app-sidebar"
        className={`sidebar${open ? ' is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        inert={!open}
        onKeyDown={onPanelKeyDown}
        onClick={(e) => e.target.closest('a') && setOpen(false)}
      >
        <div className="sidebar__top">
          <Link to="/" className="sidebar__logo" aria-label="Bilharz, home">
            <Logo />
          </Link>
          <button type="button" className="sidebar__close" aria-label="Close navigation" onClick={() => setOpen(false)}>
            <CloseIcon />
          </button>
        </div>

        <nav aria-label="App">
          <ul className="sidebar__nav">
            {nav.map(({ to, label, Icon, match, badge }) => {
              const active = match.some((p) => pathname === p || pathname.startsWith(`${p}/`))
              return (
                <li key={to}>
                  <Link
                    to={to}
                    className={`sidebar__link${active ? ' sidebar__link--active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon className="sidebar__icon" />
                    <span className="sidebar__label">{label}</span>
                    {badge && waiting !== null && (
                      <span className="sidebar__badge">
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

        <div className="sidebar__account">
          {account ? (
            <>
              <p className="sidebar__setting-label">Signed in as</p>
              <p className="sidebar__setting-value">
                <span>{account.name}</span>
                <button type="button" className="text-link sidebar__change sidebar__signout" onClick={() => signOut()}>
                  Sign out
                </button>
              </p>
              <p className="sidebar__account-role">
                {account.status === 'pending' ? 'Waiting for approval' : account.role === 'admin' ? 'Admin' : 'Reviewer'}
              </p>
            </>
          ) : (
            <>
              <p className="sidebar__setting-label">Reviewers</p>
              <p className="sidebar__setting-value">
                <Link to={`/sign-in?next=${encodeURIComponent(pathname)}`} className="text-link">
                  Sign in
                </Link>
                <Link to="/sign-up" className="text-link sidebar__change">
                  Create an account
                </Link>
              </p>
            </>
          )}
        </div>

        <div className="sidebar__setting">
          <p className="sidebar__setting-label">Decision setting</p>
          <p className="sidebar__setting-value">
            <span>{config?.setting ?? 'Safety'}</span>
            <Link to="/performance#use-setting" className="text-link sidebar__change">
              Change
            </Link>
          </p>
        </div>

        <p className="sidebar__disclaimer">Research prototype. Not a medical device.</p>
      </aside>
    </>
  )
}
