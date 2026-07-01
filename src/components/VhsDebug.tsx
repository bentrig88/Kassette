import { useState } from 'react'
import { VHS_PARAMS } from '../hooks/useVhsParams'

/**
 * Dev tuning panel for the VHS overlay + displacement band (bottom-right 📼).
 * Controlled: values + onChange come from useVhsParams (shared with AuthScreen).
 */
interface VhsDebugProps {
  vals: Record<string, number>
  onChange: (key: string, value: number) => void
}

export function VhsDebug({ vals, onChange }: VhsDebugProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="dbg-root dbg-root--vhs">
      {open && (
        <div className="dbg-panel">
          <div className="dbg-title">VHS debug</div>
          {VHS_PARAMS.map((p) => (
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
                onChange={(e) => onChange(p.key, Number(e.target.value))}
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
