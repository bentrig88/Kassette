import { usePlayerStore } from '../store/playerStore'

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

  return (
    <div className="playlist-controller">
      <div className="playlist-controller-title">Playlist Filters</div>
      <div className="playlist-sliders">
        <Slider
          label="Playlist Pace"
          leftLabel="Slow"
          rightLabel="Fast"
          value={tempoFilter}
          onChange={setTempoFilter}
        />
        <Slider
          label="Playlist Energy"
          leftLabel="Low"
          rightLabel="High"
          value={energyFilter}
          onChange={setEnergyFilter}
        />
        <Slider
          label="Playlist Mood"
          leftLabel="Sad"
          rightLabel="Happy"
          value={moodFilter}
          onChange={setMoodFilter}
        />
      </div>
      <div className="playlist-controller-note">
        Audio analysis (Essentia.js) — Phase 2
      </div>
    </div>
  )
}
