import { useEffect, useState } from 'react'

/**
 * Dev tuning panel for the VHS overlay (bottom-right 📼 toggle). Each slider
 * drives a CSS variable read by the .vhs-* layers; values persist to localStorage.
 */
interface Param {
  key: string
  label: string
  cssVar: string
  min: number
  max: number
  step: number
  def: number
  unit?: string
}

const PARAMS: Param[] = [
  { key: 'grain', label: 'Grain', cssVar: '--vhs-grain-op', min: 0, max: 0.6, step: 0.01, def: 0.22 },
  { key: 'grainSpeed', label: 'Grain speed', cssVar: '--vhs-grain-speed', min: 0.1, max: 1.5, step: 0.05, def: 0.45, unit: 's' },
  { key: 'scan', label: 'Scanlines', cssVar: '--vhs-scan-op', min: 0, max: 1, step: 0.05, def: 1 },
  { key: 'scanGap', label: 'Scanline gap', cssVar: '--vhs-scan-gap', min: 2, max: 8, step: 1, def: 3, unit: 'px' },
  { key: 'glitch', label: 'Glitch', cssVar: '--vhs-glitch-op', min: 0, max: 1, step: 0.01, def: 0.7 },
  { key: 'glitchSpeed', label: 'Glitch speed', cssVar: '--vhs-glitch-speed', min: 0.3, max: 4, step: 0.1, def: 1.7, unit: 's' },
  { key: 'bar', label: 'Scan bar', cssVar: '--vhs-bar-op', min: 0, max: 1, step: 0.05, def: 1 },
  { key: 'barSpeed', label: 'Bar speed', cssVar: '--vhs-bar-speed', min: 2, max: 15, step: 0.5, def: 7, unit: 's' },
  { key: 'vignette', label: 'Vignette', cssVar: '--vhs-vig-op', min: 0, max: 1, step: 0.05, def: 1 },
  { key: 'flicker', label: 'Flicker floor', cssVar: '--vhs-flicker-min', min: 0.6, max: 1, step: 0.01, def: 0.9 },
]

const LS_KEY = 'kassette-vhs-params'

function loadInitial(): Record<string, number> {
  let saved: Record<string, number> = {}
  try {
    saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}')
  } catch {/* ignore */}
  const init: Record<string, number> = {}
  for (const p of PARAMS) init[p.key] = typeof saved[p.key] === 'number' ? saved[p.key] : p.def
  return init
}

export function VhsDebug() {
  const [open, setOpen] = useState(false)
  const [vals, setVals] = useState<Record<string, number>>(loadInitial)

  useEffect(() => {
    const root = document.documentElement
    for (const p of PARAMS) {
      root.style.setProperty(p.cssVar, p.unit ? `${vals[p.key]}${p.unit}` : String(vals[p.key]))
    }
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(vals))
    } catch {/* ignore */}
  }, [vals])

  return (
    <div className="dbg-root">
      {open && (
        <div className="dbg-panel">
          <div className="dbg-title">VHS debug</div>
          {PARAMS.map((p) => (
            <div className="dbg-row" key={p.key}>
              <label>
                {p.label} <span>{parseFloat(vals[p.key].toFixed(2))}{p.unit ?? ''}</span>
              </label>
              <input
                type="range"
                min={p.min}
                max={p.max}
                step={p.step}
                value={vals[p.key]}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setVals((prev) => ({ ...prev, [p.key]: v }))
                }}
              />
            </div>
          ))}
        </div>
      )}
      <button className="dbg-toggle" onClick={() => setOpen((o) => !o)} title="VHS debug" aria-label="VHS debug">
        &#128252;
      </button>
    </div>
  )
}
