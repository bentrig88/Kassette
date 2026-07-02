import { useCallback, useMemo, useState } from 'react'
import { usePlayerStore } from '../store/playerStore'
import { sortTracksByFilters, shuffleTracks } from '../services/appleMusic'
import { buildNormalizer } from '../services/featureNormalize'
import { SubgenreSelect } from './SubgenreSelect'
import type { Track } from '../types/music'

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
  const markFilterTouched = usePlayerStore((s) => s.markFilterTouched)
  const featuresMap = usePlayerStore((s) => s.featuresMap)
  const currentCassette = usePlayerStore((s) => s.currentCassette)
  const currentTrackIndex = usePlayerStore((s) => s.currentTrackIndex)
  const isInserted = usePlayerStore((s) => s.isInserted)
  const queuedTracks = usePlayerStore((s) => s.queuedTracks)

  // Selected subgenres; empty = "All" (no subgenre restriction).
  const [subgenres, setSubgenres] = useState<string[]>([])

  // All distinct subgenres in the cassette. Selecting one filters across the
  // FULL track set (see applyAll), so listing the full set here is correct.
  const subgenreOptions = useMemo(() => {
    const set = new Set<string>()
    for (const t of currentCassette?.tracks ?? []) for (const g of t.genreNames) set.add(g)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [currentCassette])

  // Full-cassette pool, shuffled once per insert. cassette.tracks is in library
  // order; without this, a subgenre selection with neutral sliders would come
  // out in album/alphabetical clumps (the zero-weight sort is stable) instead
  // of feeling like a mixtape. Shuffled once (not per drag) so the order is
  // stable across slider moves within one insert.
  const [shuffledPool, setShuffledPool] = useState<Track[]>(() => shuffleTracks(currentCassette?.tracks ?? []))

  // Reset to All whenever a new cassette is inserted (adjust-state-on-change
  // pattern — runs during render, no effect).
  const [seenCassetteId, setSeenCassetteId] = useState(currentCassette?.id)
  if (currentCassette?.id !== seenCassetteId) {
    setSeenCassetteId(currentCassette?.id)
    setSubgenres([])
    setShuffledPool(shuffleTracks(currentCassette?.tracks ?? []))
  }

  // Rebuild the upcoming queue from the full base queue (minus already-played),
  // optionally restricted to the selected subgenres (ANY match), then sorted by
  // the sliders. Basing on baseQueue (not the current, possibly-filtered queue)
  // lets clearing the selection restore everything.
  // Reads all store state imperatively via getState() so the callback is stable
  // (empty dep array) — applyAll is only ever called from event handlers, never
  // during render, so getState() always returns the latest committed state.
  const applyAll = useCallback(
    (tempo: number, energy: number, mood: number, subs: string[], subgenrePool: Track[]) => {
      const s = usePlayerStore.getState()
      if (!s.isInserted) return

      // When nothing is playing, ANY filter change (sliders or subgenres)
      // rebuilds the WHOLE queue — including the "now" track — so the NOW
      // display reflects the new filters; otherwise the current track is
      // preserved and only the upcoming list changes. (The slider auto-snap in
      // CassettePlayer is suppressed while stopped so this rebuild can't yank
      // the sliders back out of the user's hands.)
      const rebuild = s.playbackState === 'stopped'
      const played = rebuild ? [] : s.queuedTracks.slice(0, s.currentTrackIndex + 1)
      const playedIds = new Set(played.map((t) => t.id))

      // Subgenre filter searches the FULL cassette via the per-insert shuffled
      // pool (so niche subgenres beyond the shuffled 100-track queue still
      // surface their tracks, in mixtape order). "All" uses the fresh 100-track
      // baseQueue to preserve the per-insert shuffle.
      const pool = subs.length > 0
        ? (subgenrePool.length > 0 ? subgenrePool : (s.currentCassette?.tracks ?? []))
        : (s.baseQueue.length > 0 ? s.baseQueue : (s.currentCassette?.tracks ?? []))
      if (pool.length === 0) return

      let candidates = pool.filter((t) => !playedIds.has(t.id))
      if (subs.length > 0) candidates = candidates.filter((t) => t.genreNames.some((g) => subs.includes(g)))
      const sortedUpcoming = sortTracksByFilters(candidates, s.featuresMap, tempo, energy, mood, buildNormalizer(s.featuresMap), s.touchedFilters)
      s.setQueuedTracks([...played, ...sortedUpcoming])

      if (rebuild) {
        // Re-point to the new first track; the next Play re-syncs MusicKit's queue
        // via playQueueFrom (see CassettePlayer.handlePlay), which is the proven
        // setQueue-then-play path.
        s.setCurrentTrackIndex(0)
      } else {
        // Re-sorted while MusicKit is mid-playback: its internal window still
        // holds the old order. Flag it; the next track boundary re-issues the
        // window from the fresh queue (see onNowPlayingChange in CassettePlayer).
        s.setQueueDirty(true)
      }
    },
    [],
  )

  function handleTempo(v: number) {
    setTempoFilter(v)
    markFilterTouched('tempo')
    applyAll(v, energyFilter, moodFilter, subgenres, shuffledPool)
  }

  function handleEnergy(v: number) {
    setEnergyFilter(v)
    markFilterTouched('energy')
    applyAll(tempoFilter, v, moodFilter, subgenres, shuffledPool)
  }

  function handleMood(v: number) {
    setMoodFilter(v)
    markFilterTouched('mood')
    applyAll(tempoFilter, energyFilter, v, subgenres, shuffledPool)
  }

  function handleSubgenres(next: string[]) {
    setSubgenres(next)
    applyAll(tempoFilter, energyFilter, moodFilter, next, shuffledPool)
  }

  const upcoming = useMemo(
    () => (queuedTracks.length > 0 ? queuedTracks : (currentCassette?.tracks ?? [])).slice(currentTrackIndex + 1),
    [queuedTracks, currentCassette, currentTrackIndex]
  )
  const analyzedUpcoming = useMemo(
    () => upcoming.filter((t) => featuresMap.has(t.id)).length,
    [upcoming, featuresMap]
  )
  // Also require ≥5 analyzed tracks library-wide so the percentile normalizer
  // can actually rank (with ≤1 it returns a flat 50 and the sliders do nothing).
  const enoughData = analyzedUpcoming >= Math.min(5, upcoming.length) && featuresMap.size >= 5
  const disabled = !isInserted || !enoughData

  return (
    <div className="pf-container">
      <div className="pf-header">
        <div className="pf-header-titles">
          <span className="pf-title">MIXTAPE FILTERS</span>
          <span className="pf-analyzed">
            {isInserted && (!enoughData
              ? (featuresMap.size < 5
                  ? 'Analyzing your library…'
                  : `Analyzing your tape… ${analyzedUpcoming}/${Math.min(upcoming.length, 20)} tracks ready`)
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
