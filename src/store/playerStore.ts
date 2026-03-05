import { create } from 'zustand'
import type { Cassette, PlaybackState, AudioQuality, Track } from '../types/music'

interface PlayerState {
  currentCassette: Cassette | null
  queuedTracks: Track[]  // shuffled queue actually loaded into MusicKit
  isInserted: boolean
  playbackState: PlaybackState
  volume: number
  quality: AudioQuality
  currentTrackIndex: number
  currentTime: number
  duration: number

  // Playlist controller values (Phase 2 will use these for Essentia.js filtering)
  tempoFilter: number  // 0-100 (slow to fast)
  energyFilter: number // 0-100 (low to high)
  moodFilter: number   // 0-100 (sad to happy)

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
  setTempoFilter: (value) => set({ tempoFilter: value }),
  setEnergyFilter: (value) => set({ energyFilter: value }),
  setMoodFilter: (value) => set({ moodFilter: value }),
}))
