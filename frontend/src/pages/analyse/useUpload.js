import { useEffect, useRef, useState } from 'react'
import { analyseUpload } from '../../api.js'

// One upload at a time and where it is: idle | uploading (progress 0–1) |
// scoring (since) | failed (message). `start` resolves to the result, or to
// null if the upload failed or was cancelled. Leaving the page cancels it.
export function useUpload() {
  const upload = useRef(null)
  const [run, setRun] = useState({ phase: 'idle' })
  const busy = run.phase === 'uploading' || run.phase === 'scoring'

  useEffect(() => () => upload.current?.abort(), [])

  async function start(files) {
    const controller = new AbortController()
    upload.current = controller
    setRun({ phase: 'uploading', progress: 0 })
    try {
      return await analyseUpload(files, {
        signal: controller.signal,
        onProgress: (progress) => setRun({ phase: 'uploading', progress }),
        onUploaded: () => setRun({ phase: 'scoring', since: Date.now() }),
      })
    } catch (error) {
      if (!controller.signal.aborted) setRun({ phase: 'failed', message: error.message })
      return null
    } finally {
      upload.current = null
    }
  }

  return { run, busy, start, reset: () => setRun({ phase: 'idle' }) }
}
