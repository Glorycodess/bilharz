import { Outlet } from 'react-router-dom'
import Header from './Header.jsx'
import './AppLayout.css'

export default function AppLayout() {
  return (
    <>
      <Header />
      <main className="app__content">
        <Outlet />
      </main>
    </>
  )
}
