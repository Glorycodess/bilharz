import { useEffect, useState } from 'react'

// Calls an async api.js function, again whenever `arg` changes.
// Returns undefined while loading.
export function useApi(fn, arg) {
  const [state, setState] = useState({ arg: undefined, data: undefined })

  useEffect(() => {
    let live = true
    fn(arg).then((data) => {
      if (live) setState({ arg, data })
    })
    return () => {
      live = false
    }
  }, [fn, arg])

  return state.arg === arg ? state.data : undefined
}
