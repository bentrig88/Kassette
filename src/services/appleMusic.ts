import { GENRES, GENRE_KEYWORDS, GENRE_COLORS } from '../types/music'
import type { Genre, Cassette, Track } from '../types/music'
import { buildNormalizer } from './featureNormalize'
import { mapPool } from '../lib/mapPool'
import { usePlayerStore } from '../store/playerStore'

const DEVELOPER_TOKEN = import.meta.env.VITE_APPLE_MUSIC_DEVELOPER_TOKEN ?? ''

let configured = false

// Cache of original MusicKit.MediaItem objects keyed by track ID.
// MusicKit sets cloudId and other internal fields on these during the API
// response — we must reuse them for setQueue rather than constructing new ones.
const rawItemCache = new Map<string, MusicKit.MediaItem>()

/** Snapshot of the raw MediaItem cache (for the library IndexedDB snapshot). */
export function getRawItemEntries(): [string, MusicKit.MediaItem][] {
  return [...rawItemCache.entries()]
}

/** Restore raw MediaItems from a library snapshot (they carry setQueue's cloudId). */
export function restoreRawItems(entries: [string, MusicKit.MediaItem][]): void {
  for (const [id, item] of entries) rawItemCache.set(id, item)
}

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
      // Shown large in Apple's Access Request popup; without it Apple falls
      // back to the site favicon rendered tiny. origin-relative so it works
      // on localhost, Vercel previews, and production alike.
      icon: `${window.location.origin}/apple-touch-icon.png`,
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
 * Fetches all library songs (Apple Music API returns max 100 per page).
 *
 * The first page reveals the library's true size (`meta.total`), so the
 * remaining pages are fetched IN PARALLEL with bounded concurrency — a large
 * library is dominated by round-trip latency, and the old one-page-at-a-time
 * loop took 50–150 sequential requests. Knowing the total also makes the
 * progress callback honest (the old running estimate pinned the loading bar
 * near-full for the whole fetch). Falls back to sequential `next`-based paging
 * if the API ever omits `meta.total`.
 */
const PAGE_LIMIT = 100
const PAGE_CONCURRENCY = 5

export async function fetchLibraryTracks(
  onProgress?: (loaded: number, total: number, tracksSoFar: Track[]) => void
): Promise<Track[]> {
  const music = MusicKit.getInstance()

  async function fetchPage(offset: number) {
    const request = () => music.api.music('/v1/me/library/songs', { limit: PAGE_LIMIT, offset })
    try {
      return (await request()).data
    } catch {
      // One retry after a short backoff (transient 429 / network hiccup)
      await new Promise((r) => setTimeout(r, 1000))
      return (await request()).data
    }
  }

  function toTracks(items: MusicKit.MediaItem[]): Track[] {
    return items.map((item) => {
      rawItemCache.set(item.id, item)
      return mapMediaItemToTrack(item)
    })
  }

  const firstPage = await fetchPage(0)
  const firstTracks = toTracks(firstPage.data)
  const total = firstPage.meta?.total

  if (typeof total !== 'number' || total <= 0) {
    // No meta.total — sequential next-based paging with the running estimate.
    const tracks = [...firstTracks]
    let offset = PAGE_LIMIT
    let hasMore = Boolean(firstPage.next) && firstPage.data.length === PAGE_LIMIT
    onProgress?.(tracks.length, hasMore ? tracks.length + PAGE_LIMIT : tracks.length, tracks)
    while (hasMore) {
      const page = await fetchPage(offset)
      tracks.push(...toTracks(page.data))
      hasMore = Boolean(page.next) && page.data.length === PAGE_LIMIT
      offset += PAGE_LIMIT
      onProgress?.(tracks.length, hasMore ? tracks.length + PAGE_LIMIT : tracks.length, tracks)
    }
    return tracks
  }

  onProgress?.(firstTracks.length, total, firstTracks)
  if (firstTracks.length >= total) return firstTracks

  const offsets: number[] = []
  for (let o = PAGE_LIMIT; o < total; o += PAGE_LIMIT) offsets.push(o)
  console.log(`[Kassette] Library: ${total} tracks — fetching ${offsets.length} pages, ${PAGE_CONCURRENCY} in parallel`)

  // `arrived` accumulates in completion order (fine for the loading-screen LCD
  // pool); the returned array is assembled in offset order for determinism.
  const arrived: Track[] = [...firstTracks]
  const pages: Track[][] = new Array(offsets.length)
  await mapPool(offsets, PAGE_CONCURRENCY, async (offset, i) => {
    const page = await fetchPage(offset)
    const pageTracks = toTracks(page.data)
    pages[i] = pageTracks
    arrived.push(...pageTracks)
    onProgress?.(arrived.length, total, arrived)
  })

  return [...firstTracks, ...pages.flat()]
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

function matchesGenre(lowerGenres: string[], genre: Genre): boolean {
  const keywords = GENRE_KEYWORDS[genre]
  return keywords.some((kw) => lowerGenres.some((tg) => tg.includes(kw)))
}

export function buildCassettes(tracks: Track[]): Cassette[] {
  const lowered = tracks.map((t) => ({ track: t, lower: t.genreNames.map((g) => g.toLowerCase()) }))
  const cassettes: Cassette[] = []

  for (const genre of GENRES) {
    const matched = lowered.filter((x) => matchesGenre(x.lower, genre)).map((x) => x.track)
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

/** Uniform Fisher-Yates shuffle (returns a new array). */
export function shuffleTracks(tracks: Track[]): Track[] {
  const shuffled = [...tracks]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

/**
 * Sets MusicKit queue to the cassette's tracks and optionally starts playback.
 */
export async function loadCassetteQueue(cassette: Cassette, startIndex = 0): Promise<Track[]> {
  const music = MusicKit.getInstance()

  const slice = shuffleTracks(cassette.tracks).slice(0, 100)

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

export interface TouchedFilters {
  tempo: boolean
  energy: boolean
  mood: boolean
}

/**
 * Sorts tracks so the ones closest to the slider TARGETS come first.
 *
 * Each slider (0–100) is a target percentile within the analyzed library, but
 * it only participates once the user has actually moved it (`touched`) — an
 * untouched slider expresses no preference. A track's score is the summed
 * distance |target − track percentile| over the touched dimensions; lower =
 * earlier in the queue. This makes every slider position meaningful (Pace 70
 * prefers mid-fast tracks over the very fastest), unlike the old directional-
 * weight scheme where 55 and 100 produced the same order.
 *
 * Pace distances use a percentile shrunk toward 50 when the BPM detection
 * confidence is low, pushing shaky detections (rubato/ambient) away from
 * extreme targets. Display (LCD BPM, slider snap) is unaffected.
 *
 * With no touched sliders the pool order is preserved verbatim; otherwise
 * unanalyzed tracks go to the end in their original (shuffled) order.
 */
export function sortTracksByFilters(
  tracks: Track[],
  featuresMap: Map<string, import('../services/featureCache').TrackFeatures>,
  tempo: number,
  energy: number,
  mood: number,
  normalizer?: import('../services/featureNormalize').FeatureNormalizer,
  touched: TouchedFilters = { tempo: true, energy: true, mood: true }
): Track[] {
  if (!touched.tempo && !touched.energy && !touched.mood) return [...tracks]

  const analyzed: Track[] = []
  const unanalyzed: Track[] = []
  for (const t of tracks) {
    const f = featuresMap.get(t.id)
    if (f && !f.unanalyzable) analyzed.push(t)
    else unanalyzed.push(t)
  }

  // Precompute each analyzed track's target-distance score once (the
  // comparator stays O(1) per pair).
  const norm = normalizer ?? buildNormalizer(featuresMap)
  const score = new Map<string, number>()
  for (const t of analyzed) {
    const f = featuresMap.get(t.id)!
    const n = norm.normalize(f)
    const conf = 0.4 + 0.6 * (f.bpmConfidence ?? 1)
    const effPace = 50 + (n.pace - 50) * conf
    let d = 0
    if (touched.tempo) d += Math.abs(tempo - effPace)
    if (touched.energy) d += Math.abs(energy - n.energy)
    if (touched.mood) d += Math.abs(mood - n.mood)
    score.set(t.id, d)
  }

  analyzed.sort((a, b) => score.get(a.id)! - score.get(b.id)!)

  return [...analyzed, ...unanalyzed]
}

/**
 * Loads a window of sorted tracks into MusicKit starting at startIndex,
 * then stops and plays. This keeps MusicKit's queue in sync with our sorted
 * queuedTracks so auto-advance and the next button both follow the right order.
 *
 * Returns false when there was nothing to play (empty/stale window) so callers
 * can unlatch any pending-play UI state.
 */
export async function playQueueFrom(tracks: Track[], startIndex: number): Promise<boolean> {
  // Any window re-issue synchronizes MusicKit with the current queue — pending
  // mid-play re-sort staleness (queueDirty) is moot from here on.
  usePlayerStore.getState().setQueueDirty(false)
  const music = getMusicKitInstance()
  const items = tracks
    .slice(startIndex, startIndex + 20)
    .map((t) => rawItemCache.get(t.id))
    .filter((item): item is MusicKit.MediaItem => item !== undefined)
  if (items.length === 0) return false
  await music.setQueue({ items })
  // setQueue already resets playback state — calling stop() before play() confuses MusicKit
  await music.play()
  return true
}
