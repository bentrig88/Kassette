import { GENRES, GENRE_KEYWORDS, GENRE_COLORS } from '../types/music'
import type { Genre, Cassette, Track } from '../types/music'

const DEVELOPER_TOKEN = import.meta.env.VITE_APPLE_MUSIC_DEVELOPER_TOKEN ?? ''

let configured = false

// Cache of original MusicKit.MediaItem objects keyed by track ID.
// MusicKit sets cloudId and other internal fields on these during the API
// response — we must reuse them for setQueue rather than constructing new ones.
const rawItemCache = new Map<string, MusicKit.MediaItem>()

export async function configureMusicKit(): Promise<void> {
  if (configured) return
  if (!DEVELOPER_TOKEN) {
    throw new Error('Missing VITE_APPLE_MUSIC_DEVELOPER_TOKEN in .env.local')
  }

  await MusicKit.configure({
    developerToken: DEVELOPER_TOKEN,
    app: {
      name: 'Kassette',
      build: '1.0.0',
    },
  })

  configured = true
}

export async function authorize(): Promise<void> {
  const music = MusicKit.getInstance()
  await music.authorize()
}

export async function unauthorize(): Promise<void> {
  const music = MusicKit.getInstance()
  await music.unauthorize()
}

export function isAuthorized(): boolean {
  try {
    return MusicKit.getInstance().isAuthorized
  } catch {
    return false
  }
}

/**
 * Fetches all library songs with pagination.
 * Apple Music API returns max 100 per page.
 */
export async function fetchLibraryTracks(
  onProgress?: (loaded: number, total: number) => void
): Promise<Track[]> {
  const music = MusicKit.getInstance()
  const tracks: Track[] = []
  const limit = 100
  let offset = 0
  let hasMore = true

  while (hasMore) {
    const response = await music.api.music('/v1/me/library/songs', {
      limit,
      offset,
    })

    const items = response.data.data
    for (const item of items) {
      rawItemCache.set(item.id, item)
      tracks.push(mapMediaItemToTrack(item))
    }

    if (response.data.next && items.length === limit) {
      offset += limit
      onProgress?.(tracks.length, tracks.length + limit)
    } else {
      hasMore = false
    }

    // Safety limit: stop at 3000 tracks to avoid infinite loops on huge libraries
    if (tracks.length >= 3000) {
      hasMore = false
    }
  }

  return tracks
}

function mapMediaItemToTrack(item: MusicKit.MediaItem): Track {
  const artwork = item.attributes.artwork
  const artworkUrl = artwork
    ? artwork.url.replace('{w}', '300').replace('{h}', '300')
    : undefined

  return {
    id: item.id,
    name: item.attributes.name,
    artistName: item.attributes.artistName,
    albumName: item.attributes.albumName,
    durationInMillis: item.attributes.durationInMillis,
    isrc: item.attributes.isrc,
    artworkUrl,
    genreNames: item.attributes.genreNames ?? [],
  }
}

function matchesGenre(track: Track, genre: Genre): boolean {
  const keywords = GENRE_KEYWORDS[genre]
  const trackGenres = track.genreNames.map((g) => g.toLowerCase())
  return keywords.some((kw) => trackGenres.some((tg) => tg.includes(kw)))
}

export function buildCassettes(tracks: Track[]): Cassette[] {
  const cassettes: Cassette[] = []

  for (const genre of GENRES) {
    const matched = tracks.filter((t) => matchesGenre(t, genre))
    if (matched.length > 0) {
      cassettes.push({
        id: genre,
        genre,
        tracks: matched,
        color: GENRE_COLORS[genre],
      })
    }
  }

  return cassettes
}

/**
 * Sets MusicKit queue to the cassette's tracks and optionally starts playback.
 */
export async function loadCassetteQueue(cassette: Cassette, startIndex = 0): Promise<Track[]> {
  const music = MusicKit.getInstance()

  // Shuffle then take the first 100 so every insert feels fresh
  const shuffled = [...cassette.tracks].sort(() => Math.random() - 0.5)
  const slice = shuffled.slice(0, 100)

  // Use original MediaItems from cache — they carry cloudId set by MusicKit's API
  const items = slice
    .map((t) => rawItemCache.get(t.id))
    .filter((item): item is MusicKit.MediaItem => item !== undefined)

  await music.setQueue({ items })

  if (startIndex > 0) {
    await music.changeToMediaAtIndex(startIndex)
  }

  return slice
}

export function getMusicKitInstance(): MusicKit.MusicKitInstance {
  return MusicKit.getInstance()
}
