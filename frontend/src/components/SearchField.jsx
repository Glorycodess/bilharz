import { SearchIcon } from './Icons.jsx'

// The "Find a sample" box in the toolbar above the Queue and Reviews tables
// (styles in Queue.css, which both pages load).
export default function SearchField({ id, value, onChange }) {
  return (
    <div className="queue__search">
      <label className="visually-hidden" htmlFor={id}>
        Find a sample
      </label>
      <SearchIcon className="queue__search-icon" />
      <input
        id={id}
        className="input queue__search-input"
        type="search"
        placeholder="Find a sample"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
