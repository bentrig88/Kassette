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
    <div className="playlist-slider-group">
      <div className="playlist-slider-label">{label}</div>
      <div className="playlist-slider-row">
        <span className="playlist-slider-end">{leftLabel}</span>
        <input
          type="range"
          className="playlist-slider"
          min={0}
          max={100}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="playlist-slider-end">{rightLabel}</span>
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
  const analyzedCount = usePlayerStore((s) => s.analyzedCount)
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

      // Only re-sort tracks AFTER the current one — current track is unaffected,
      // so "next" immediately reflects the new filter without jumping around.
      const played = tracks.slice(0, currentTrackIndex + 1)
      const upcoming = tracks.slice(currentTrackIndex + 1)
      const sortedUpcoming = sortTracksByFilters(upcoming, featuresMap, tempo, energy, mood)
      setQueuedTracks([...played, ...sortedUpcoming])
      // currentTrackIndex stays the same — no need to update it
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
    <div className="playlist-controller">
      <div className="playlist-controller-title">Playlist Filters</div>
      <div className={`playlist-sliders ${disabled ? 'playlist-sliders--disabled' : ''}`}>
        <Slider label="Pace" leftLabel="Slow" rightLabel="Fast" value={tempoFilter} onChange={disabled ? () => {} : handleTempo} />
        <Slider label="Energy" leftLabel="Low" rightLabel="High" value={energyFilter} onChange={disabled ? () => {} : handleEnergy} />
        <Slider label="Mood" leftLabel="Sad" rightLabel="Happy" value={moodFilter} onChange={disabled ? () => {} : handleMood} />
      </div>
      {isInserted && (
        <div className="playlist-controller-note">
          {!enoughData
            ? `Analyzing your tape… ${analyzedUpcoming}/${Math.min(upcoming.length, 20)} tracks ready`
            : `${analyzedUpcoming} upcoming tracks analyzed`}
        </div>
      )}
    </div>
  )
}
