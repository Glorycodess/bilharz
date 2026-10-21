import { Link } from 'react-router-dom'
import './Logo.css'

// A blue dot inside a thin ring, so it never reads as the solid
// "Referred" status dot.
export default function Logo() {
  return (
    <Link to="/" className="logo" aria-label="Bilharz, home">
      <svg className="logo__mark" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="11" cy="11" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="11" cy="11" r="5" fill="currentColor" />
      </svg>
      <span className="logo__word">Bilharz</span>
    </Link>
  )
}
