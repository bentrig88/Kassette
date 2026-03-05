import { create } from 'zustand'
import type { Cassette, Track } from '../types/music'

interface MusicState {
  isAuthenticated: boolean
  isLoading: boolean
  loadingProgress: number // 0-100
  cassettes: Cassette[]
  selectedCassetteIndex: number
  error: string | null

  setAuthenticated: (value: boolean) => void
  setLoading: (value: boolean) => void
  setLoadingProgress: (value: number) => void
  setCassettes: (cassettes: Cassette[]) => void
  setSelectedIndex: (index: number) => void
  setError: (error: string | null) => void
}

export const useMusicStore = create<MusicState>((set) => ({
  isAuthenticated: false,
  isLoading: false,
  loadingProgress: 0,
  cassettes: [],
  selectedCassetteIndex: 0,
  error: null,

  setAuthenticated: (value) => set({ isAuthenticated: value }),
  setLoading: (value) => set({ isLoading: value }),
  setLoadingProgress: (value) => set({ loadingProgress: value }),
  setCassettes: (cassettes) => set({ cassettes }),
  setSelectedIndex: (index) => set({ selectedCassetteIndex: index }),
  setError: (error) => set({ error }),
}))

// Selector helpers
export const selectedCassette = (state: MusicState): Cassette | null =>
  state.cassettes[state.selectedCassetteIndex] ?? null

export type { Track }
