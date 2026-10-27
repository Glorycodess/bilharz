import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { EXPECTED_IMAGES, TILES_PER_IMAGE, analyseUpload, getConfig, getQueue } from '../api.js'
import { pending, useApi } from '../useApi.js'
import { formatCount } from '../format.js'
import Button from '../components/Button.jsx'
import PageState from '../components/PageState.jsx'
import { CheckIcon, UploadIcon } from '../components/Icons.jsx'
import './Analyse.css'

const TOTAL_TILES = EXPECTED_IMAGES * TILES_PER_IMAGE

// Every file from a drop, including the contents of dropped folders.
async function filesFromDrop(dataTransfer) {
  // Entries must be read synchronously, before the first await.
  const entries = [...dataTransfer.items].map((item) => item.webkitGetAsEntry?.()).filter(Boolean)
  if (entries.length === 0) return [...dataTransfer.files]
  const files = []
  async function walk(entry) {
    if (entry.isFile) {
      files.push(await new Promise((resolve, reject) => entry.file(resolve, reject)))
    } else if (entry.isDirectory) {
      const reader = entry.createReader()
      for (;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject))
        if (batch.length === 0) break
        for (const child of batch) await walk(child)
      }
    }
  }
  for (const entry of entries) await walk(entry)
  return files
}

// Exactly the sample's JPEGs, in name order; system files like .DS_Store are skipped.
function checkFiles(all) {
  const files = all
    .filter((f) => !f.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const notJpeg = files.filter((f) => !/\.jpe?g$/i.test(f.name))
  if (files.length === 0) return { files: [], error: 'No images found. Choose the folder with the sample’s images.' }
  if (notJpeg.length > 0) {
    const what = notJpeg.length === 1 ? '1 file is' : `${notJpeg.length} files are`
    return {
      files: [],
      error: `${what} not a JPEG (for example ${notJpeg[0].name}). A sample is ${EXPECTED_IMAGES} .jpg images.`,
    }
  }
  if (files.length !== EXPECTED_IMAGES) {
    return {
      files: [],
      error: `${files.length} ${files.length === 1 ? 'image' : 'images'} found. A sample needs exactly ${EXPECTED_IMAGES}.`,
    }
  }
  return { files, error: null }
}

export default function Analyse() {
  const navigate = useNavigate()
  const queue = useApi(getQueue)
  const config = useApi(getConfig)
  const folderInput = useRef(null)
  const upload = useRef(null)
  const [selection, setSelection] = useState({ files: [], error: null })
  const [dragging, setDragging] = useState(false)
  const [sampleId, setSampleId] = useState('')
  // idle | uploading (progress 0–1) | scoring (since) | failed (message)
  const [run, setRun] = useState({ phase: 'idle' })
  const busy = run.phase === 'uploading' || run.phase === 'scoring'

  // Leaving the page cancels an upload in progress.
  useEffect(() => () => upload.current?.abort(), [])

  const waiting = pending(queue, config)
  if (waiting) return <PageState {...waiting} />

  function choose(list) {
    setSelection(checkFiles([...list]))
    setRun({ phase: 'idle' })
  }

  async function onDrop(event) {
    event.preventDefault()
    setDragging(false)
    if (busy) return
    choose(await filesFromDrop(event.dataTransfer))
  }

  async function start() {
    const controller = new AbortController()
    upload.current = controller
    setRun({ phase: 'uploading', progress: 0 })
    try {
      const result = await analyseUpload(selection.files, {
        signal: controller.signal,
        onProgress: (progress) => setRun({ phase: 'uploading', progress }),
        onUploaded: () => setRun({ phase: 'scoring', since: Date.now() }),
      })
      navigate('/samples/upload', { state: { result } })
    } catch (error) {
      if (!controller.signal.aborted) setRun({ phase: 'failed', message: error.message })
    } finally {
      upload.current = null
    }
  }

  function onSubmit(event) {
    event.preventDefault()
    if (sampleId) navigate(`/samples/${sampleId}`)
  }

  const ready = selection.files.length === EXPECTED_IMAGES

  return (
    <div className="container page">
      <header className="analyse__head">
        <h1 className="headline h1">Analyse a sample</h1>
        <p className="lead">
          Add the {EXPECTED_IMAGES} microscope images of one urine sample. Bilharz scores every tile and returns one
          decision.
        </p>
      </header>

      <div className="analyse">
        <div className="analyse__inputs">
          <div
            className={`dropzone${dragging ? ' dropzone--active' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              if (!busy) setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <UploadIcon className="dropzone__icon" />
            <p className="dropzone__title">Drop the sample&rsquo;s {EXPECTED_IMAGES} images</p>
            <p className="muted small">JPEG, one folder per sample</p>
            <input
              ref={folderInput}
              id="sample-images"
              type="file"
              accept="image/jpeg"
              multiple
              webkitdirectory=""
              hidden
              onChange={(e) => {
                choose(e.target.files)
                e.target.value = ''
              }}
            />
            <div className="dropzone__actions">
              {ready ? (
                <>
                  <Button onClick={start} disabled={busy}>
                    Analyse {EXPECTED_IMAGES} images
                  </Button>
                  <Button variant="link" onClick={() => folderInput.current?.click()} disabled={busy}>
                    Choose another folder
                  </Button>
                </>
              ) : (
                <Button onClick={() => folderInput.current?.click()} disabled={busy}>
                  Choose folder
                </Button>
              )}
            </div>
            <p className={`dropzone__status${selection.error ? ' dropzone__status--error' : ''}`} role="status">
              {selection.error ?? (ready && `${EXPECTED_IMAGES} images selected. Ready to analyse.`)}
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
                disabled={busy}
              >
                <option value="">Choose a sample</option>
                {queue.data.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn btn--primary" disabled={!sampleId || busy}>
                Analyse
              </button>
            </div>
          </form>

          <p className="analyse__setting muted">
            Decision setting: <span className="strong">{config.data.setting}</span>, the default.{' '}
            <Link to="/performance" className="text-link">
              Compare settings
            </Link>
          </p>
        </div>

        <ProgressPanel run={run} onRetry={ready ? start : null} />
      </div>
    </div>
  )
}

function ProgressPanel({ run, onRetry }) {
  const now = useNow(run.phase === 'scoring')

  if (run.phase === 'idle') {
    return (
      <section className="progress progress--empty" aria-label="Analysis progress">
        <p className="eyebrow">Analysing</p>
        <p className="progress__empty">Nothing yet. Choose a folder of images or a sample to start.</p>
      </section>
    )
  }

  if (run.phase === 'failed') {
    return (
      <section className="progress" aria-label="Analysis progress">
        <p className="eyebrow">Analysis stopped</p>
        <p className="progress__error" role="alert">
          {run.message}
        </p>
        {onRetry && (
          <Button variant="link" onClick={onRetry}>
            Try again
          </Button>
        )}
      </section>
    )
  }

  const uploading = run.phase === 'uploading'
  const percent = uploading ? Math.round(run.progress * 100) : 100
  const seconds = uploading ? 0 : Math.max(0, Math.floor((now - run.since) / 1000))
  const steps = [
    { label: `${EXPECTED_IMAGES} images checked`, state: 'done' },
    { label: uploading ? `Uploading ${percent}%` : 'Uploaded', state: uploading ? 'active' : 'done' },
    { label: `Scoring ${formatCount(TOTAL_TILES)} tiles`, state: uploading ? 'pending' : 'active' },
    { label: 'Decision', state: 'pending' },
  ]

  return (
    <section className="progress" aria-label="Analysis progress">
      <p className="eyebrow">Analysing</p>
      <p className="progress__id number">Your sample</p>
      {uploading ? (
        <div
          className="progress__track"
          role="progressbar"
          aria-label="Upload"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div className="progress__fill" style={{ width: `${percent}%` }} />
        </div>
      ) : (
        <div className="progress__track progress__track--busy" role="progressbar" aria-label="Scoring tiles">
          <div className="progress__fill" />
        </div>
      )}
      <p className="progress__count" aria-live="polite">
        {uploading ? `Uploading ${percent}%` : `Scoring ${formatCount(TOTAL_TILES)} tiles… ${seconds} s`}
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

// The current time, updated every second while `active`.
function useNow(active) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}
