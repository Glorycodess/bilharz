import { useEffect, useState, useSyncExternalStore } from 'react'
import { dataVersion, subscribe } from './api.js'

const AUTO_RETRY_MS = 10000

// Calls an async api.js function, again whenever `arg` changes or server data
// changes. Returns { data, error, retry, retrying }: `data` is undefined while
// loading. If the server can't be reached, it retries once by itself.
export function useApi(fn, arg) {
  const version = useSyncExternalStore(subscribe, dataVersion)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ arg: undefined, key: null, data: undefined, error: null })
  const key = `${version}:${attempt}`

  useEffect(() => {
    let live = true
    fn(arg).then(
      (data) => live && setState({ arg, key, data, error: null }),
      (error) => live && setState((s) => ({ arg, key, data: s.arg === arg ? s.data : undefined, error })),
    )
    return () => {
      live = false
    }
  }, [fn, arg, key])

  const error = state.arg === arg && state.key === key ? state.error : null
  const retrying = Boolean(error?.unreachable) && attempt === 0

  useEffect(() => {
    if (!retrying) return
    const timer = setTimeout(() => setAttempt((a) => a + 1), AUTO_RETRY_MS)
    return () => clearTimeout(timer)
  }, [retrying])

  return {
    // Keep showing the last data for this argument while a refresh loads.
    data: state.arg === arg ? state.data : undefined,
    error,
    retrying,
    retry: () => setAttempt((a) => a + 1),
  }
}

// The first request in a list that isn't ready yet, for <PageState />.
export function pending(...requests) {
  return requests.find((r) => r.data === undefined)
}
