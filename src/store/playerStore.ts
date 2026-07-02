import { create } from 'zustand'
import type { Cassette, PlaybackState, AudioQuality, Track } from '../types/music'
import type { TrackFeatures } from '../services/featureCache'

interface PlayerState {
  currentCassette: Cassette | null
  queuedTracks: Track[]
  baseQueue: Track[]      // full shuffled queue at insert — source for subgenre re-filtering
  isInserted: boolean
  playbackState: PlaybackState
  volume: number
  quality: AudioQuality
  currentTrackIndex: number
  currentTime: number
  duration: number

  tempoFilter: number   // 0–100 target percentile (slow → fast BPM)
  energyFilter: number  // 0–100 target percentile (low → high energy)
  moodFilter: number    // 0–100 target percentile (sad → happy)

  // A slider only filters once the USER has moved it ("touched"). The auto-snap
  // moves slider positions to the playing track's percentiles but clears these
  // flags — a snapped position is information, not intent. Reset on insert.
  touchedFilters: { tempo: boolean; energy: boolean; mood: boolean }
  markFilterTouched: (which: 'tempo' | 'energy' | 'mood') => void
  /** Set all three slider values WITHOUT marking them touched (auto-snap). */
  snapFilters: (tempo: number, energy: number, mood: number) => void

  // True when queuedTracks was re-sorted while MusicKit was mid-playback (its
  // internal 20-track window then holds the OLD order). Checked at the next
  // track boundary, which re-issues the window from the fresh queue; cleared
  // by every playQueueFrom (any manual window sync makes it moot).
  queueDirty: boolean
  setQueueDirty: (dirty: boolean) => void

  // Audio features keyed by track ID — grows as tracks are analyzed
  featuresMap: Map<string, TrackFeatures>
  analyzedCount: number

  insertSourceRect: { top: number; left: number; width: number; height: number } | null
  setInsertSourceRect: (rect: { top: number; left: number; width: number; height: number } | null) => void

  insertCassette: (cassette: Cassette) => void
  setQueuedTracks: (tracks: Track[]) => void
  setBaseQueue: (tracks: Track[]) => void
  ejectCassette: () => void
  setPlaybackState: (state: PlaybackState) => void
  setVolume: (volume: number) => void
  setQuality: (quality: AudioQuality) => void
  setCurrentTrackIndex: (index: number) => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  setTempoFilter: (value: number) => void
  setEnergyFilter: (value: number) => void
  setMoodFilter: (value: number) => void
  addFeatures: (features: TrackFeatures) => void
  bulkAddFeatures: (features: TrackFeatures[]) => void
}

export const usePlayerStore = create<PlayerState>((set) => ({
  currentCassette: null,
  queuedTracks: [],
  baseQueue: [],
  isInserted: false,
  playbackState: 'stopped',
  volume: 0.8,
  quality: 'hi',
  currentTrackIndex: 0,
  currentTime: 0,
  duration: 0,

  tempoFilter: 50,
  energyFilter: 50,
  moodFilter: 50,

  touchedFilters: { tempo: false, energy: false, mood: false },
  markFilterTouched: (which) => set((s) => ({ touchedFilters: { ...s.touchedFilters, [which]: true } })),
  snapFilters: (tempo, energy, mood) =>
    set({ tempoFilter: tempo, energyFilter: energy, moodFilter: mood, touchedFilters: { tempo: false, energy: false, mood: false } }),

  queueDirty: false,
  setQueueDirty: (dirty) => set({ queueDirty: dirty }),

  featuresMap: new Map(),
  analyzedCount: 0,

  insertSourceRect: null,
  setInsertSourceRect: (rect) => set({ insertSourceRect: rect }),

  insertCassette: (cassette) =>
    set({ currentCassette: cassette, isInserted: true, currentTrackIndex: 0, playbackState: 'stopped', queuedTracks: [], baseQueue: [], queueDirty: false, touchedFilters: { tempo: false, energy: false, mood: false } }),

  setQueuedTracks: (tracks) => set({ queuedTracks: tracks }),
  setBaseQueue: (tracks) => set({ baseQueue: tracks }),

  ejectCassette: () =>
    set({ currentCassette: null, queuedTracks: [], baseQueue: [], isInserted: false, playbackState: 'stopped', currentTime: 0, duration: 0, queueDirty: false }),

  setPlaybackState: (state) => set({ playbackState: state }),
  setVolume: (volume) => set({ volume }),
  setQuality: (quality) => set({ quality }),
  setCurrentTrackIndex: (index) => set({ currentTrackIndex: index }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),

  setTempoFilter: (value) => set({ tempoFilter: value }),
  setEnergyFilter: (value) => set({ energyFilter: value }),
  setMoodFilter: (value) => set({ moodFilter: value }),

  addFeatures: (features) =>
    set((s) => {
      const next = new Map(s.featuresMap)
      next.set(features.id, features)
      return { featuresMap: next, analyzedCount: next.size }
    }),

  bulkAddFeatures: (features) =>
    set((s) => {
      const next = new Map(s.featuresMap)
      for (const f of features) next.set(f.id, f)
      return { featuresMap: next, analyzedCount: next.size }
    }),
}))
