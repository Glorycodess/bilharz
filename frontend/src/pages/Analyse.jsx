import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { EXPECTED_IMAGES, getConfig, getQueue } from '../api.js'
import { pending, useApi } from '../useApi.js'
import PageHeader from '../components/PageHeader.jsx'
import PageState from '../components/PageState.jsx'
import FolderUpload from './analyse/FolderUpload.jsx'
import ProgressPanel from './analyse/ProgressPanel.jsx'
import SamplePicker from './analyse/SamplePicker.jsx'
import { checkFiles } from './analyse/sampleFiles.js'
import { useUpload } from './analyse/useUpload.js'
import './Analyse.css'

export default function Analyse() {
  const navigate = useNavigate()
  const queue = useApi(getQueue)
  const config = useApi(getConfig)
  const [selection, setSelection] = useState({ files: [], error: null })
  const { run, busy, start, reset } = useUpload()

  const waiting = pending(queue, config)
  if (waiting) return <PageState {...waiting} />

  function choose(files) {
    setSelection(checkFiles(files))
    reset()
  }

  async function analyse() {
    const result = await start(selection.files)
    if (result) navigate('/samples/upload', { state: { result } })
  }

  const ready = selection.files.length === EXPECTED_IMAGES
  const isDefault = config.data.key === config.data.defaultKey

  return (
    <div className="container page">
      <PageHeader
        title="Analyse a sample"
        summary={`Add the ${EXPECTED_IMAGES} microscope images of one urine sample. Bilharz scores every tile and returns one decision.`}
      />

      <div className="analyse">
        <div className="analyse__inputs">
          <FolderUpload selection={selection} ready={ready} busy={busy} onChoose={choose} onStart={analyse} />
          <SamplePicker samples={queue.data} disabled={busy} />
          <p className="analyse__setting muted">
            Decision setting: <span className="strong">{config.data.setting}</span>
            {isDefault ? ', the default.' : '.'}{' '}
            <Link to="/performance#use-setting" className="text-link">
              {isDefault ? 'Compare settings' : 'Change setting'}
            </Link>
          </p>
        </div>

        <ProgressPanel run={run} onRetry={ready ? analyse : null} />
      </div>
    </div>
  )
}
