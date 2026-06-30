import { useCallback, useMemo, useState } from 'react'
import { usePlayerStore } from '../store/playerStore'
import { sortTracksByFilters, setQueueTracks } from '../services/appleMusic'
import { SubgenreSelect } from './SubgenreSelect'

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
  const baseQueue = usePlayerStore((s) => s.baseQueue)
  const isInserted = usePlayerStore((s) => s.isInserted)
  const playbackState = usePlayerStore((s) => s.playbackState)
  const setCurrentTrackIndex = usePlayerStore((s) => s.setCurrentTrackIndex)

  // Selected subgenres; empty = "All" (no subgenre restriction).
  const [subgenres, setSubgenres] = useState<string[]>([])

  // All distinct subgenres in the cassette. Selecting one filters across the
  // FULL track set (see applyAll), so listing the full set here is correct.
  const subgenreOptions = useMemo(() => {
    const set = new Set<string>()
    for (const t of currentCassette?.tracks ?? []) for (const g of t.genreNames) set.add(g)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [currentCassette])

  // Reset to All whenever a new cassette is inserted (adjust-state-on-change
  // pattern — runs during render, no effect).
  const [seenCassetteId, setSeenCassetteId] = useState(currentCassette?.id)
  if (currentCassette?.id !== seenCassetteId) {
    setSeenCassetteId(currentCassette?.id)
    setSubgenres([])
  }

  // Rebuild the upcoming queue from the full base queue (minus already-played),
  // optionally restricted to the selected subgenres (ANY match), then sorted by
  // the sliders. Basing on baseQueue (not the current, possibly-filtered queue)
  // lets clearing the selection restore everything.
  const applyAll = useCallback(
    (tempo: number, energy: number, mood: number, subs: string[], rebuildNow = false) => {
      if (!isInserted) return

      // When nothing is playing, a subgenre change rebuilds the WHOLE queue
      // (including the "now" track) so it reflects the new selection; otherwise
      // the current track is preserved and only the upcoming list changes.
      const rebuild = rebuildNow && playbackState === 'stopped'
      const played = rebuild ? [] : queuedTracks.slice(0, currentTrackIndex + 1)
      const playedIds = new Set(played.map((t) => t.id))

      // Subgenre filter searches the FULL cassette (so niche subgenres beyond the
      // shuffled 100-track queue still surface their tracks). "All" uses the fresh
      // 100-track baseQueue to preserve the per-insert shuffle.
      const pool = subs.length > 0
        ? (currentCassette?.tracks ?? [])
        : (baseQueue.length > 0 ? baseQueue : (currentCassette?.tracks ?? []))
      if (pool.length === 0) return

      let candidates = pool.filter((t) => !playedIds.has(t.id))
      if (subs.length > 0) candidates = candidates.filter((t) => t.genreNames.some((g) => subs.includes(g)))
      const sortedUpcoming = sortTracksByFilters(candidates, featuresMap, tempo, energy, mood)
      const newQueue = [...played, ...sortedUpcoming]
      setQueuedTracks(newQueue)

      if (rebuild) {
        // Re-point to the new first track and re-sync MusicKit's queue (without
        // playing) so pressing Play starts at the refreshed "now" track.
        setCurrentTrackIndex(0)
        setQueueTracks(newQueue).catch(() => {})
      }
    },
    [isInserted, playbackState, baseQueue, currentCassette, queuedTracks, currentTrackIndex, featuresMap, setQueuedTracks, setCurrentTrackIndex]
  )

  function handleTempo(v: number) {
    setTempoFilter(v)
    applyAll(v, energyFilter, moodFilter, subgenres)
  }

  function handleEnergy(v: number) {
    setEnergyFilter(v)
    applyAll(tempoFilter, v, moodFilter, subgenres)
  }

  function handleMood(v: number) {
    setMoodFilter(v)
    applyAll(tempoFilter, energyFilter, v, subgenres)
  }

  function handleSubgenres(next: string[]) {
    setSubgenres(next)
    applyAll(tempoFilter, energyFilter, moodFilter, next, true)
  }

  const upcoming = (queuedTracks.length > 0 ? queuedTracks : (currentCassette?.tracks ?? []))
    .slice(currentTrackIndex + 1)
  const analyzedUpcoming = upcoming.filter((t) => featuresMap.has(t.id)).length
  const enoughData = analyzedUpcoming >= Math.min(5, upcoming.length)
  const disabled = !isInserted || !enoughData

  return (
    <div className="pf-container">
      <div className="pf-header">
        <div className="pf-header-titles">
          <span className="pf-title">MIXTAPE FILTERS</span>
          <span className="pf-analyzed">
            {isInserted && (!enoughData
              ? `Analyzing your tape… ${analyzedUpcoming}/${Math.min(upcoming.length, 20)} tracks ready`
              : analyzedUpcoming > 0 ? `${analyzedUpcoming} upcoming tracks analyzed` : '')}
          </span>
        </div>
        <SubgenreSelect
          options={subgenreOptions}
          selected={subgenres}
          onChange={handleSubgenres}
          disabled={!isInserted}
        />
      </div>
      <div className={`pf-sliders${disabled ? ' pf-sliders--disabled' : ''}`}>
        <Slider label="Pace" leftLabel="Slow" rightLabel="Fast" value={tempoFilter} onChange={disabled ? () => {} : handleTempo} />
        <Slider label="Energy" leftLabel="Low" rightLabel="High" value={energyFilter} onChange={disabled ? () => {} : handleEnergy} />
        <Slider label="Mood" leftLabel="Sad" rightLabel="Happy" value={moodFilter} onChange={disabled ? () => {} : handleMood} />
      </div>
    </div>
  )
}
