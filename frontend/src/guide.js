// Whether this browser has hidden the first-time guide. A preference, not
// personal data, so it is kept in localStorage; where storage is blocked it
// lasts until the tab reloads. The Landing page shows the guide, and the
// footer offers it again once it is hidden.
import { useSyncExternalStore } from 'react'

export const GUIDE_KEY = 'bilharz.guideHidden'

const listeners = new Set()
let hidden = readStored()

function readStored() {
  try {
    return localStorage.getItem(GUIDE_KEY) === '1'
  } catch {
    return false
  }
}

function set(value) {
  hidden = value
  try {
    if (value) localStorage.setItem(GUIDE_KEY, '1')
    else localStorage.removeItem(GUIDE_KEY)
  } catch {
    // storage blocked: remember it in memory only
  }
  listeners.forEach((listener) => listener())
}

export function hideGuide() {
  set(true)
}

export function showGuide() {
  set(false)
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useGuideHidden() {
  return useSyncExternalStore(subscribe, () => hidden)
}
