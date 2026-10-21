import { useEffect, useRef, useState } from 'react'
import { Outlet } from 'react-router-dom'
import Logo from './Logo.jsx'
import Sidebar from './Sidebar.jsx'
import { MenuIcon } from './Icons.jsx'
import './AppLayout.css'

const SMALL = '(max-width: 899px)'
const RAIL_KEY = 'bilharz.sidebar'

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const list = window.matchMedia(query)
    const onChange = () => setMatches(list.matches)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])
  return matches
}

function readRail() {
  try {
    return localStorage.getItem(RAIL_KEY) === 'collapsed'
  } catch {
    return false
  }
}

// Sidebar plus content for the app screens. On small screens the sidebar
// becomes a drawer opened from a slim top bar.
export default function AppLayout() {
  const small = useMediaQuery(SMALL)
  const [open, setOpen] = useState(false)
  const drawerOpen = small && open
  const menuButton = useRef(null)
  const closeButton = useRef(null)
  const wasOpen = useRef(false)
  const [collapsed, setCollapsed] = useState(readRail)
  const rail = collapsed && !small

  useEffect(() => {
    try {
      localStorage.setItem(RAIL_KEY, collapsed ? 'collapsed' : 'expanded')
    } catch {
      // Storage unavailable: the choice lasts for this visit only.
    }
  }, [collapsed])

  useEffect(() => {
    if (small) return
    const onKey = (e) => {
      if (e.key !== '[' || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return
      setCollapsed((c) => !c)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [small])

  useEffect(() => {
    if (drawerOpen) {
      closeButton.current?.focus()
      const onKey = (e) => {
        if (e.key === 'Escape') setOpen(false)
      }
      document.addEventListener('keydown', onKey)
      document.body.style.overflow = 'hidden'
      wasOpen.current = true
      return () => {
        document.removeEventListener('keydown', onKey)
        document.body.style.overflow = ''
      }
    }
    if (wasOpen.current) {
      wasOpen.current = false
      menuButton.current?.focus()
    }
  }, [drawerOpen])

  return (
    <div className={`app${rail ? ' app--rail' : ''}`}>
      <header className="app__topbar" inert={drawerOpen}>
        <Logo />
        <button
          ref={menuButton}
          type="button"
          className="app__menu"
          aria-label="Open menu"
          aria-expanded={drawerOpen}
          aria-controls="app-sidebar"
          onClick={() => setOpen(true)}
        >
          <MenuIcon />
        </button>
      </header>

      <Sidebar
        id="app-sidebar"
        closeRef={closeButton}
        drawer={small}
        open={drawerOpen}
        onClose={() => setOpen(false)}
        rail={rail}
        onToggleRail={() => setCollapsed((c) => !c)}
      />
      {drawerOpen && <div className="app__backdrop" aria-hidden="true" onClick={() => setOpen(false)} />}

      <main className="app__content" inert={drawerOpen}>
        <Outlet />
      </main>
    </div>
  )
}
