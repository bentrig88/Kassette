export const GENRES = ['Rock', 'Hip-Hop', 'Electronic', 'Reggae', 'Classical', 'Folk'] as const
export type Genre = typeof GENRES[number]

export const GENRE_COLORS: Record<Genre, string> = {
  'Rock': '#c0392b',
  'Hip-Hop': '#8e44ad',
  'Electronic': '#2980b9',
  'Reggae': '#27ae60',
  'Classical': '#d4a017',
  'Folk': '#e67e22',
}

export const GENRE_KEYWORDS: Record<Genre, string[]> = {
  'Rock': ['rock', 'metal', 'punk', 'grunge', 'alternative', 'indie rock', 'hard rock'],
  'Hip-Hop': ['hip-hop', 'hip hop', 'rap', 'trap', 'r&b', 'r&amp;b'],
  'Electronic': ['electronic', 'electro', 'techno', 'house', 'edm', 'dance', 'synth', 'trance', 'ambient'],
  'Reggae': ['reggae', 'dancehall', 'ska', 'dub'],
  'Classical': ['classical', 'orchestra', 'symphony', 'opera', 'chamber', 'baroque', 'piano'],
  'Folk': ['folk', 'country', 'bluegrass', 'acoustic', 'singer-songwriter', 'americana'],
}

export interface Track {
  id: string
  name: string
  artistName: string
  albumName: string
  durationInMillis: number
  isrc?: string
  artworkUrl?: string
  genreNames: string[]
}

export interface Cassette {
  id: string
  genre: Genre
  tracks: Track[]
  color: string
}

export type PlaybackState = 'stopped' | 'playing' | 'paused' | 'loading' | 'seeking'

export type AudioQuality = 'lo' | 'mid' | 'hi'
