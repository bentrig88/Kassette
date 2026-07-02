import { useEffect, useState } from 'react'

/**
 * Shared VHS tuning parameters. CSS-driven params (with a `cssVar`) are written
 * to :root and read by the .vhs-* / .auth-stage layers; SVG-driven params (no
 * `cssVar`, e.g. displacement scale/roughness) are consumed directly by the
 * feDisplacementMap in AuthScreen. All persist to localStorage.
 */
export interface VhsParam {
  key: string
  label: string
  min: number
  max: number
  step: number
  def: number
  unit?: string
  cssVar?: string
}

export const VHS_PARAMS: VhsParam[] = [
  { key: 'globalDisp', label: 'Global wobble', min: 0, max: 30, step: 1, def: 4 },
  { key: 'dispScale', label: 'Band displacement', min: 0, max: 80, step: 1, def: 42 },
  { key: 'dispRough', label: 'Tear roughness', min: 0.1, max: 1.5, step: 0.05, def: 0.25 },
  { key: 'bandThickMin', label: 'Band thick. min', unit: '%', min: 2, max: 20, step: 1, def: 5 },
  { key: 'bandThickMax', label: 'Band thick. max', unit: '%', min: 4, max: 35, step: 1, def: 14 },
  { key: 'bandSpeed', label: 'Band speed', unit: 's', min: 3, max: 20, step: 0.5, def: 9 },
  { key: 'grain', label: 'Grain', cssVar: '--vhs-grain-op', min: 0, max: 0.6, step: 0.01, def: 0.22 },
  { key: 'grainSpeed', label: 'Grain speed', cssVar: '--vhs-grain-speed', unit: 's', min: 0.1, max: 1.5, step: 0.05, def: 0.45 },
  { key: 'scan', label: 'Scanlines', cssVar: '--vhs-scan-op', min: 0, max: 1, step: 0.05, def: 0.6 },
  { key: 'scanGap', label: 'Scanline gap', cssVar: '--vhs-scan-gap', unit: 'px', min: 2, max: 8, step: 1, def: 3 },
  { key: 'glitch', label: 'Color glitch', cssVar: '--vhs-glitch-op', min: 0, max: 1, step: 0.01, def: 0.27 },
  { key: 'glitchSpeed', label: 'Glitch speed', cssVar: '--vhs-glitch-speed', unit: 's', min: 0.3, max: 4, step: 0.1, def: 1.7 },
  { key: 'vignette', label: 'Vignette', cssVar: '--vhs-vig-op', min: 0, max: 1, step: 0.05, def: 0.45 },
  { key: 'flicker', label: 'Flicker floor', cssVar: '--vhs-flicker-min', min: 0.6, max: 1, step: 0.01, def: 0.76 },
]

const LS_KEY = 'kassette-vhs-params'

function loadInitial(): Record<string, number> {
  let saved: Record<string, number> = {}
  try {
    saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}')
  } catch {/* ignore */}
  const init: Record<string, number> = {}
  for (const p of VHS_PARAMS) init[p.key] = typeof saved[p.key] === 'number' ? saved[p.key] : p.def
  return init
}

export function useVhsParams() {
  const [vals, setVals] = useState<Record<string, number>>(loadInitial)

  useEffect(() => {
    const root = document.documentElement
    for (const p of VHS_PARAMS) {
      if (p.cssVar) root.style.setProperty(p.cssVar, p.unit ? `${vals[p.key]}${p.unit}` : String(vals[p.key]))
    }
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(vals))
    } catch {/* ignore */}
  }, [vals])

  const set = (key: string, v: number) => setVals((prev) => ({ ...prev, [key]: v }))
  return { vals, set }
}
