import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

// Opens the stored result of a sample from the evaluation set.
export default function SamplePicker({ samples, disabled }) {
  const navigate = useNavigate()
  const [sampleId, setSampleId] = useState('')

  function onSubmit(event) {
    event.preventDefault()
    if (sampleId) navigate(`/samples/${sampleId}`)
  }

  return (
    <form className="analyse__form" onSubmit={onSubmit}>
      <label className="field-label" htmlFor="sample-select">
        Or use a sample from the evaluation set
      </label>
      <div className="analyse__row">
        <select
          id="sample-select"
          className="input analyse__select"
          value={sampleId}
          onChange={(e) => setSampleId(e.target.value)}
          disabled={disabled}
        >
          <option value="">Choose a sample</option>
          {samples.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn--primary" disabled={!sampleId || disabled}>
          Analyse
        </button>
      </div>
    </form>
  )
}
