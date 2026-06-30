import { useEffect, useState } from 'react'

/**
 * Dev-only tuning panel (tape-selection state, bottom-right). Two sliders drive
 * CSS variables read by the genre background:
 *   --genre-bg-blur    → blur strength on the photo (.genre-bg-photo)
 *   --genre-bg-overlay → opacity of the dark scrim (.genre-bg-scrim); 0 = none
 * Values persist to localStorage so tuning survives reloads.
 */
const BLUR_KEY = 'kassette-dbg-blur'
const OVERLAY_KEY = 'kassette-dbg-scrim'

function readNum(key: string, fallback: number): number {
  const v = Number(localStorage.getItem(key))
  return Number.isFinite(v) && localStorage.getItem(key) !== null ? v : fallback
}

export function BackgroundDebug() {
  const [open, setOpen] = useState(false)
  const [blur, setBlur] = useState(() => readNum(BLUR_KEY, 2))
  const [overlay, setOverlay] = useState(() => readNum(OVERLAY_KEY, 1))

  useEffect(() => {
    document.documentElement.style.setProperty('--genre-bg-blur', `${blur}px`)
    localStorage.setItem(BLUR_KEY, String(blur))
  }, [blur])

  useEffect(() => {
    document.documentElement.style.setProperty('--genre-bg-overlay', String(overlay))
    localStorage.setItem(OVERLAY_KEY, String(overlay))
  }, [overlay])

  return (
    <div className="dbg-root">
      {open && (
        <div className="dbg-panel">
          <div className="dbg-title">Background debug</div>
          <div className="dbg-row">
            <label>Blur <span>{blur.toFixed(1)}px</span></label>
            <input
              type="range"
              min={0}
              max={20}
              step={0.5}
              value={blur}
              onChange={(e) => setBlur(Number(e.target.value))}
            />
          </div>
          <div className="dbg-row">
            <label>Dark overlay <span>{overlay.toFixed(2)}</span></label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={overlay}
              onChange={(e) => setOverlay(Number(e.target.value))}
            />
          </div>
        </div>
      )}
      <button
        className="dbg-toggle"
        onClick={() => setOpen((o) => !o)}
        title="Background debug"
        aria-label="Background debug"
      >
        &#9881;
      </button>
    </div>
  )
}
