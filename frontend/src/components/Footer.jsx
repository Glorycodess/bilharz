import { Link } from 'react-router-dom'
import './Footer.css'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container footer__inner">
        <p>Bilharz · Final-year capstone, African Leadership University · Glory Paul</p>
        <p>
          Research prototype. Not a medical device. ·{' '}
          <Link to="/privacy" className="text-link">
            Privacy policy
          </Link>
        </p>
      </div>
    </footer>
  )
}
