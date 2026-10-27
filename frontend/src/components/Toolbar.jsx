import './Toolbar.css'

// The row above a table: filter tabs on the left; search and secondary actions
// on the right. Wraps onto two lines on small screens.
export default function Toolbar({ start, end }) {
  return (
    <div className="toolbar">
      <div className="toolbar__start">{start}</div>
      {end && <div className="toolbar__end">{end}</div>}
    </div>
  )
}
