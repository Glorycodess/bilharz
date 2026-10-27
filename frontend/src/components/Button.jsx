import { Link } from 'react-router-dom'
import './Button.css'

// Primary: black button. Outline: white with a black border, for page actions.
// Link: text link with an arrow.
export default function Button({ to, variant = 'primary', children, className = '', ...props }) {
  const classes = `btn btn--${variant} ${className}`.trim()
  const content = (
    <>
      {children}
      {variant === 'link' && <span aria-hidden="true"> →</span>}
    </>
  )

  if (to) {
    return (
      <Link to={to} className={classes} {...props}>
        {content}
      </Link>
    )
  }
  return (
    <button type="button" className={classes} {...props}>
      {content}
    </button>
  )
}
