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

    // Safety limit

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

  const playParams = (item.attributes as unknown as { playParams?: { catalogId?: string } }).playParams
  const catalogId: string | undefined = playParams?.catalogId

  return {
    id: item.id,
    catalogId,
    name: item.attributes.name,
    artistName: item.attributes.artistName,
    albumName: item.attributes.albumName,
    durationInMillis: item.attributes.durationInMillis,
    isrc: item.attributes.isrc,
    artworkUrl,
    genreNames: item.attributes.genreNames ?? [],
  }
}

/**
 * Fetches 30-second preview URLs from the Apple Music catalog for a batch of tracks.
 * Returns a map of libraryTrackId → previewUrl.
 * Preview audio is unencrypted and can be decoded offline for BPM/energy/mood analysis.
 */
export async function fetchPreviewUrls(tracks: Track[]): Promise<Map<string, string>> {
  const music = getMusicKitInstance()
  const storefront: string = (music as unknown as { storefrontId?: string }).storefrontId ?? 'us'
  const withCatalog = tracks.filter((t) => t.catalogId)
  const result = new Map<string, string>()
  if (withCatalog.length === 0) return result

  const catalogToLibrary = new Map<string, string>()
  for (const t of withCatalog) catalogToLibrary.set(t.catalogId!, t.id)

  const CHUNK = 300
  for (let i = 0; i < withCatalog.length; i += CHUNK) {
    const chunk = withCatalog.slice(i, i + CHUNK)
    const ids = chunk.map((t) => t.catalogId!).join(',')
    try {
      const res = await music.api.music(`/v1/catalog/${storefront}/songs`, { ids })
      for (const song of (res.data.data ?? []) as { id: string; attributes: { previews?: { url: string }[] } }[]) {
        const url = song.attributes.previews?.[0]?.url
        if (!url) continue
        const libraryId = catalogToLibrary.get(song.id)
        if (libraryId) result.set(libraryId, url)
      }
    } catch {/* skip chunk on error */}
  }
  return result
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

/**
 * Re-orders tracks so the ones whose features best match the filter values
 * come first. Tracks without analysis data go at the end (shuffled).
 *
 * Slider values are 0–100. BPM is normalized: 60 BPM → 0, 180 BPM → 100.
 */
/**
 * Sorts tracks based on how well they match the slider directions.
 *
 * Each slider (0–100) is treated as a directional preference, not a target:
 *   - 50 = neutral (no influence on sort order for that dimension)
 *   - < 50 = prefer lower values (e.g. slow tempo → low BPM first)
 *   - > 50 = prefer higher values (e.g. fast tempo → high BPM first)
 *
 * Unanalyzed tracks go to the end in their original (shuffled) order.
 */
export function sortTracksByFilters(
  tracks: Track[],
  featuresMap: Map<string, import('../services/featureCache').TrackFeatures>,
  tempo: number,
  energy: number,
  mood: number
): Track[] {
  const analyzed: Track[] = []
  const unanalyzed: Track[] = []
  for (const t of tracks) {
    if (featuresMap.has(t.id)) analyzed.push(t)
    else unanalyzed.push(t)
  }

  // Convert slider 0–100 to a direction weight: -1 (want low) → 0 (neutral) → +1 (want high)
  const tw = (tempo - 50) / 50   // tempo weight
  const ew = (energy - 50) / 50
  const mw = (mood - 50) / 50

  analyzed.sort((a, b) => {
    const fa = featuresMap.get(a.id)!
    const fb = featuresMap.get(b.id)!

    // Normalize BPM 60–180 → 0–100
    const bpmA = Math.min(100, Math.max(0, ((fa.bpm - 60) / 120) * 100))
    const bpmB = Math.min(100, Math.max(0, ((fb.bpm - 60) / 120) * 100))

    // Score = weighted sum; higher score → should appear later in queue
    // When tw > 0 (want fast): high BPM gets low score → sorted first ✓
    const scoreA = -(tw * bpmA + ew * fa.energy + mw * fa.mood)
    const scoreB = -(tw * bpmB + ew * fb.energy + mw * fb.mood)

    return scoreA - scoreB
  })

  return [...analyzed, ...unanalyzed]
}

/**
 * Loads a window of sorted tracks into MusicKit starting at startIndex,
 * then stops and plays. This keeps MusicKit's queue in sync with our sorted
 * queuedTracks so auto-advance and the next button both follow the right order.
 */
export async function playQueueFrom(tracks: Track[], startIndex: number): Promise<void> {
  const music = getMusicKitInstance()
  const items = tracks
    .slice(startIndex, startIndex + 20)
    .map((t) => rawItemCache.get(t.id))
    .filter((item): item is MusicKit.MediaItem => item !== undefined)
  if (items.length === 0) return
  await music.setQueue({ items })
  // setQueue already resets playback state — calling stop() before play() confuses MusicKit
  await music.play()
}
