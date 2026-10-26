import './Logo.css'

// A blue dot inside a thin ring, so it never reads as the solid
// "Referred" status dot.
export default function Logo() {
  return (
    <span className="logo">
      <svg className="logo__mark" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="11" cy="11" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="11" cy="11" r="5" fill="currentColor" />
      </svg>
      <span className="logo__word">Bilharz</span>
    </span>
  )
}
