import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import AppLayout from './components/AppLayout.jsx'
import Landing from './pages/Landing.jsx'
import Analyse from './pages/Analyse.jsx'
import Result from './pages/Result.jsx'
import Review from './pages/Review.jsx'
import Queue from './pages/Queue.jsx'
import Performance from './pages/Performance.jsx'
import Reviews from './pages/Reviews.jsx'
import NotFound from './pages/NotFound.jsx'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Landing />} />
          <Route path="/analyse" element={<Analyse />} />
          <Route path="/samples/:id" element={<Result />} />
          <Route path="/review/:id" element={<Review />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/reviews" element={<Reviews />} />
          <Route path="/performance" element={<Performance />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  )
}
