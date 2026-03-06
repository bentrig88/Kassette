export const GENRES = ['Rock', 'Hip-Hop', 'Electronic', 'Reggae', 'Classical', 'Folk', 'Jazz', 'Pop'] as const
export type Genre = typeof GENRES[number]

export const GENRE_COLORS: Record<Genre, string> = {
  'Rock': '#c0392b',
  'Hip-Hop': '#8e44ad',
  'Electronic': '#2980b9',
  'Reggae': '#27ae60',
  'Classical': '#d4a017',
  'Folk': '#e67e22',
  'Jazz': '#1a6b8a',
  'Pop': '#e91e8c',
}

export const GENRE_KEYWORDS: Record<Genre, string[]> = {
  'Rock': [
    'rock', 'metal', 'punk', 'grunge', 'alternative', 'indie rock', 'hard rock',
    'blues', 'prog-rock', 'art rock',
  ],
  'Hip-Hop': [
    'hip-hop', 'hip hop', 'rap', 'trap', 'r&b', 'r&amp;b', 'soul',
    'uk hip-hop', 'afro rap',
  ],
  'Electronic': [
    'electronic', 'electro', 'techno', 'house', 'edm', 'dance', 'synth', 'trance', 'ambient',
    'idm', 'experimental', 'bass', 'breakbeat', 'électronique', 'drum and bass',
    'dubstep', 'garage', 'jungle', 'anime',
  ],
  'Reggae': [
    'reggae', 'dancehall', 'ska', 'dub',
    'afro-beat', 'afrobeat', 'afro beat', 'worldwide',
  ],
  'Classical': [
    'classical', 'orchestra', 'symphony', 'opera', 'chamber', 'baroque', 'piano',
    'instrumental', 'soundtrack', 'score',
  ],
  'Folk': [
    'folk', 'country', 'bluegrass', 'acoustic',
    'singer-songwriter', 'singer/songwriter', 'americana',
  ],
  'Jazz': [
    'jazz', 'fusion', 'bebop', 'swing', 'bossa nova', 'smooth jazz', 'contemporary jazz',
  ],
  'Pop': [
    'pop', 'french pop', 'synth-pop', 'indie pop', 'dream pop', 'holiday', 'vocal',
  ],
}

export interface Track {
  id: string
  catalogId?: string   // Apple Music catalog ID, used to fetch audio features
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
