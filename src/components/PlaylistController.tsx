import { useCallback } from 'react'
import { usePlayerStore } from '../store/playerStore'
import { sortTracksByFilters } from '../services/appleMusic'

interface SliderProps {
  label: string
  leftLabel: string
  rightLabel: string
  value: number
  onChange: (v: number) => void
}

function Slider({ label, leftLabel, rightLabel, value, onChange }: SliderProps) {
  return (
    <div className="pf-filter">
      <div className="pf-filter-label">{label}</div>
      <div className="pf-slider-track">
        <input
          type="range"
          className="pf-slider"
          min={0}
          max={100}
          value={value}
          style={{ '--pf-fill': `${value}%` } as React.CSSProperties}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
      <div className="pf-labels">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  )
}

export function PlaylistController() {
  const tempoFilter = usePlayerStore((s) => s.tempoFilter)
  const energyFilter = usePlayerStore((s) => s.energyFilter)
  const moodFilter = usePlayerStore((s) => s.moodFilter)
  const setTempoFilter = usePlayerStore((s) => s.setTempoFilter)
  const setEnergyFilter = usePlayerStore((s) => s.setEnergyFilter)
  const setMoodFilter = usePlayerStore((s) => s.setMoodFilter)
  const featuresMap = usePlayerStore((s) => s.featuresMap)
  const queuedTracks = usePlayerStore((s) => s.queuedTracks)
  const currentCassette = usePlayerStore((s) => s.currentCassette)
  const currentTrackIndex = usePlayerStore((s) => s.currentTrackIndex)
  const setQueuedTracks = usePlayerStore((s) => s.setQueuedTracks)
  const isInserted = usePlayerStore((s) => s.isInserted)

  const applyFilters = useCallback(
    (tempo: number, energy: number, mood: number) => {
      if (!isInserted) return
      const tracks = queuedTracks.length > 0 ? queuedTracks : (currentCassette?.tracks ?? [])
      if (tracks.length === 0) return

      const played = tracks.slice(0, currentTrackIndex + 1)
      const upcoming = tracks.slice(currentTrackIndex + 1)
      const sortedUpcoming = sortTracksByFilters(upcoming, featuresMap, tempo, energy, mood)
      setQueuedTracks([...played, ...sortedUpcoming])
    },
    [isInserted, queuedTracks, currentCassette, currentTrackIndex, featuresMap, setQueuedTracks]
  )

  function handleTempo(v: number) {
    setTempoFilter(v)
    applyFilters(v, energyFilter, moodFilter)
  }

  function handleEnergy(v: number) {
    setEnergyFilter(v)
    applyFilters(tempoFilter, v, moodFilter)
  }

  function handleMood(v: number) {
    setMoodFilter(v)
    applyFilters(tempoFilter, energyFilter, v)
  }

  const upcoming = (queuedTracks.length > 0 ? queuedTracks : (currentCassette?.tracks ?? []))
    .slice(currentTrackIndex + 1)
  const analyzedUpcoming = upcoming.filter((t) => featuresMap.has(t.id)).length
  const enoughData = analyzedUpcoming >= Math.min(5, upcoming.length)
  const disabled = !isInserted || !enoughData

  return (
    <div className="pf-container">
      <div className="pf-header">
        <span className="pf-title">PLAYLIST FILTERS</span>
        <span className="pf-analyzed">
          {isInserted && (!enoughData
            ? `Analyzing your tape… ${analyzedUpcoming}/${Math.min(upcoming.length, 20)} tracks ready`
            : analyzedUpcoming > 0 ? `${analyzedUpcoming} upcoming tracks analyzed` : '')}
        </span>
      </div>
      <div className={`pf-sliders${disabled ? ' pf-sliders--disabled' : ''}`}>
        <Slider label="Pace" leftLabel="Slow" rightLabel="Fast" value={tempoFilter} onChange={disabled ? () => {} : handleTempo} />
        <Slider label="Energy" leftLabel="Low" rightLabel="High" value={energyFilter} onChange={disabled ? () => {} : handleEnergy} />
        <Slider label="Mood" leftLabel="Sad" rightLabel="Happy" value={moodFilter} onChange={disabled ? () => {} : handleMood} />
      </div>
    </div>
  )
}
