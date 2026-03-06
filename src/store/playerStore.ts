import { create } from 'zustand'
import type { Cassette, PlaybackState, AudioQuality, Track } from '../types/music'
import type { TrackFeatures } from '../services/featureCache'

interface PlayerState {
  currentCassette: Cassette | null
  queuedTracks: Track[]
  isInserted: boolean
  playbackState: PlaybackState
  volume: number
  quality: AudioQuality
  currentTrackIndex: number
  currentTime: number
  duration: number

  tempoFilter: number   // 0–100 (slow → fast BPM)
  energyFilter: number  // 0–100 (low → high energy)
  moodFilter: number    // 0–100 (sad → happy)
  filtersActive: boolean // true when any slider is off-center

  // Audio features keyed by track ID — grows as tracks are analyzed
  featuresMap: Map<string, TrackFeatures>
  analyzedCount: number

  insertCassette: (cassette: Cassette) => void
  setQueuedTracks: (tracks: Track[]) => void
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

function isActive(tempo: number, energy: number, mood: number) {
  return tempo !== 50 || energy !== 50 || mood !== 50
}

export const usePlayerStore = create<PlayerState>((set) => ({
  currentCassette: null,
  queuedTracks: [],
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
  filtersActive: false,

  featuresMap: new Map(),
  analyzedCount: 0,

  insertCassette: (cassette) =>
    set({ currentCassette: cassette, isInserted: true, currentTrackIndex: 0, playbackState: 'stopped', queuedTracks: [] }),

  setQueuedTracks: (tracks) => set({ queuedTracks: tracks }),

  ejectCassette: () =>
    set({ currentCassette: null, queuedTracks: [], isInserted: false, playbackState: 'stopped', currentTime: 0, duration: 0 }),

  setPlaybackState: (state) => set({ playbackState: state }),
  setVolume: (volume) => set({ volume }),
  setQuality: (quality) => set({ quality }),
  setCurrentTrackIndex: (index) => set({ currentTrackIndex: index }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),

  setTempoFilter: (value) => set((s) => ({ tempoFilter: value, filtersActive: isActive(value, s.energyFilter, s.moodFilter) })),
  setEnergyFilter: (value) => set((s) => ({ energyFilter: value, filtersActive: isActive(s.tempoFilter, value, s.moodFilter) })),
  setMoodFilter: (value) => set((s) => ({ moodFilter: value, filtersActive: isActive(s.tempoFilter, s.energyFilter, value) })),

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
