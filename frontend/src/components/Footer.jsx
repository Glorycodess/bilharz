import { Link } from 'react-router-dom'
import { showGuide, useGuideHidden } from '../guide.js'
import './Footer.css'

export default function Footer() {
  const guideHidden = useGuideHidden()

  function onShowGuide() {
    showGuide()
    window.scrollTo(0, 0)
  }

  return (
    <footer className="footer">
      <div className="container footer__inner">
        <p>Bilharz · Final-year capstone, African Leadership University · Glory Paul</p>
        <p>
          Research prototype. Not a medical device. ·{' '}
          <Link to="/privacy" className="text-link">
            Privacy policy
          </Link>
          {guideHidden && (
            <>
              {' '}
              ·{' '}
              <button type="button" className="footer__guide text-link" onClick={onShowGuide}>
                Show the first-time guide
              </button>
            </>
          )}
        </p>
      </div>
    </footer>
  )
}
