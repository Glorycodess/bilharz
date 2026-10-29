import { useRef, useState } from 'react'
import { EXPECTED_IMAGES } from '../../api.js'
import Button from '../../components/Button.jsx'
import { UploadIcon } from '../../components/Icons.jsx'
import { filesFromDrop } from './sampleFiles.js'

// The drop zone and folder picker. `onChoose` gets every file found; the page
// checks them and passes back the `selection`.
export default function FolderUpload({ selection, ready, busy, onChoose, onStart }) {
  const folderInput = useRef(null)
  const [dragging, setDragging] = useState(false)

  async function onDrop(event) {
    event.preventDefault()
    setDragging(false)
    if (busy) return
    onChoose(await filesFromDrop(event.dataTransfer))
  }

  return (
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
          onChoose([...e.target.files])
          e.target.value = ''
        }}
      />
      <div className="dropzone__actions">
        {ready ? (
          <>
            <Button onClick={onStart} disabled={busy}>
              Analyse {EXPECTED_IMAGES} images
            </Button>
            <Button variant="link" onClick={() => folderInput.current?.click()} disabled={busy}>
              Choose another folder
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={() => folderInput.current?.click()} disabled={busy}>
            Choose folder
          </Button>
        )}
      </div>
      <p className={`dropzone__status${selection.error ? ' dropzone__status--error' : ''}`} role="status">
        {selection.error ?? (ready && `${EXPECTED_IMAGES} images selected. Ready to analyse.`)}
      </p>
    </div>
  )
}
