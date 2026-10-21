import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getConfig, getQueue } from '../api.js'
import { useApi } from '../useApi.js'
import Button from '../components/Button.jsx'
import { CheckIcon, UploadIcon } from '../components/Icons.jsx'
import './Analyse.css'

// Simulated run, in milliseconds. Replaced by real progress once the
// backend scores uploads.
const RECEIVE_END = 300
const CUT_END = 600
const SCORE_END = 2700
const TOTAL = 3000

export default function Analyse() {
  const navigate = useNavigate()
  const queue = useApi(getQueue)
  const config = useApi(getConfig)
  const fileInput = useRef(null)
  const [files, setFiles] = useState([])
  const [dragging, setDragging] = useState(false)
  const [sampleId, setSampleId] = useState('')
  const [run, setRun] = useState(null) // { id, elapsed }

  useEffect(() => {
    if (!run?.id) return
    let frame
    const start = performance.now()
    const tick = (now) => {
      const elapsed = Math.min(now - start, TOTAL)
      setRun((r) => (r ? { ...r, elapsed } : r))
      if (elapsed < TOTAL) frame = requestAnimationFrame(tick)
      else navigate(`/samples/${run.id}`)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [run?.id, navigate])

  function addFiles(list) {
    setFiles(Array.from(list).filter((f) => f.type.startsWith('image/') || /\.jpe?g$/i.test(f.name)))
  }

  function onDrop(event) {
    event.preventDefault()
    setDragging(false)
    addFiles(event.dataTransfer.files)
  }

  function onSubmit(event) {
    event.preventDefault()
    if (sampleId) setRun({ id: sampleId, elapsed: 0 })
  }

  const running = run !== null

  return (
    <div className="container page">
      <header className="analyse__head">
        <h1 className="headline h1">Analyse a sample</h1>
        <p className="lead">
          Add the 117 microscope images of one urine sample. Bilharz scores every tile and returns one decision.
        </p>
      </header>

      <div className="analyse">
        <div className="analyse__inputs">
          <div
            className={`dropzone${dragging ? ' dropzone--active' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <UploadIcon className="dropzone__icon" />
            <p className="dropzone__title">Drop the sample&rsquo;s 117 images</p>
            <p className="muted small">JPEG, one folder per sample</p>
            <input
              ref={fileInput}
              id="sample-images"
              type="file"
              accept="image/jpeg"
              multiple
              hidden
              onChange={(e) => addFiles(e.target.files)}
            />
            <Button className="dropzone__button" onClick={() => fileInput.current?.click()} disabled={running}>
              Choose images
            </Button>
            <p className="dropzone__status" role="status">
              {files.length > 0 &&
                `${files.length} ${files.length === 1 ? 'image' : 'images'} selected`}
            </p>
          </div>

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
                disabled={running}
              >
                <option value="">Choose a sample</option>
                {queue?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn btn--primary" disabled={!sampleId || running}>
                Analyse
              </button>
            </div>
          </form>

          <p className="analyse__setting muted">
            Decision setting: <span className="strong">{config?.setting ?? 'Safety'}</span>, the default.{' '}
            <Link to="/performance" className="text-link">
              Compare settings
            </Link>
          </p>
        </div>

        <ProgressPanel run={run} totalTiles={config?.tilesPerSample ?? 1404} images={config?.imagesPerSample ?? 117} />
      </div>
    </div>
  )
}

function ProgressPanel({ run, totalTiles, images }) {
  if (!run) {
    return (
      <section className="progress progress--empty" aria-label="Analysis progress">
        <p className="eyebrow">Analysing</p>
        <p className="progress__empty">Nothing yet. Choose images or a sample to start.</p>
      </section>
    )
  }

  const { id, elapsed } = run
  const scored =
    elapsed <= CUT_END ? 0 : Math.min(totalTiles, Math.round(((elapsed - CUT_END) / (SCORE_END - CUT_END)) * totalTiles))
  const fmt = (n) => n.toLocaleString('en-US')
  const stepState = (start, end) => (elapsed >= end ? 'done' : elapsed >= start ? 'active' : 'pending')
  const steps = [
    { label: `${images} images received`, state: stepState(0, RECEIVE_END) },
    { label: `${fmt(totalTiles)} tiles cut`, state: stepState(RECEIVE_END, CUT_END) },
    { label: 'Scoring tiles', state: stepState(CUT_END, SCORE_END) },
    { label: 'Decision', state: stepState(SCORE_END, TOTAL) },
  ]

  return (
    <section className="progress" aria-label="Analysis progress">
      <p className="eyebrow">Analysing</p>
      <p className="progress__id number">{id}</p>
      <div
        className="progress__track"
        role="progressbar"
        aria-label={`Analysing ${id}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((elapsed / TOTAL) * 100)}
      >
        <div className="progress__fill" style={{ width: `${(elapsed / TOTAL) * 100}%` }} />
      </div>
      <p className="progress__count">
        Scoring tile {fmt(Math.max(scored, 1))} of {fmt(totalTiles)}
      </p>
      <ol className="progress__steps">
        {steps.map((s) => (
          <li key={s.label} className={`progress__step progress__step--${s.state}`}>
            <span className="progress__icon" aria-hidden="true">
              {s.state === 'done' ? <CheckIcon /> : <span className="progress__dot" />}
            </span>
            {s.label}
            <span className="visually-hidden">
              {s.state === 'done' ? ', done' : s.state === 'active' ? ', in progress' : ''}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
