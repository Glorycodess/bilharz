import { useState } from 'react'
import './EggGuide.css'

const KEY = 'bilharz.eggGuideOpen'

// Open by default; the reviewer's choice lasts for this browser session only.
function readOpen() {
  try {
    return sessionStorage.getItem(KEY) !== 'closed'
  } catch {
    return true
  }
}

// A reminder of what to look for, for reviewers who are already trained. The
// picture is a drawing, not a dataset tile.
export default function EggGuide() {
  const [open, setOpen] = useState(readOpen)

  function onToggle(event) {
    const next = event.currentTarget.open
    setOpen(next)
    try {
      sessionStorage.setItem(KEY, next ? 'open' : 'closed')
    } catch {
      // Storage unavailable: the panel just won't remember its state.
    }
  }

  return (
    <details className="egg-guide" open={open} onToggle={onToggle}>
      <summary className="egg-guide__summary">What does an egg look like?</summary>
      <div className="egg-guide__body">
        <figure className="egg-guide__figure">
          <svg
            className="egg-guide__drawing"
            viewBox="0 0 150 70"
            width="120"
            height="56"
            role="img"
            aria-labelledby="egg-guide-title"
          >
            <title id="egg-guide-title">
              Drawing of a Schistosoma haematobium egg: an elongated oval with a small spine at one end
            </title>
            <path
              d="M14 35 C14 19 38 11 66 11 C94 11 118 21 124 35 C118 49 94 59 66 59 C38 59 14 51 14 35 Z"
              fill="#EDEDED"
              stroke="#6B6B6B"
              strokeWidth="2"
            />
            <path d="M123 31 L140 35 L123 39 Z" fill="#6B6B6B" />
            <ellipse cx="68" cy="35" rx="40" ry="16" fill="#E2E2E2" stroke="#BDBDBD" strokeWidth="1.2" />
            <g fill="#BDBDBD">
              <circle cx="50" cy="31" r="2" />
              <circle cx="62" cy="39" r="1.6" />
              <circle cx="74" cy="29" r="1.8" />
              <circle cx="84" cy="38" r="1.5" />
              <circle cx="94" cy="32" r="1.7" />
            </g>
          </svg>
          <figcaption className="egg-guide__caption">Drawing, not to scale. The spine is at the right.</figcaption>
        </figure>
        <p>
          <em>S. haematobium</em> eggs are oval, about 110–170 µm long, pale yellow to golden-brown, with a small
          spine at one end.
        </p>
        <p>
          Common lookalikes: debris, fibres, crystals and air bubbles. They lack the regular oval shape and the end
          spine.
        </p>
        <p className="egg-guide__note">
          This guide is a reminder for trained reviewers, not training. Bilharz is a research prototype.
        </p>
      </div>
    </details>
  )
}
