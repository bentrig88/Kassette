import { useEffect, useRef } from 'react'
import { usePlayerStore } from '../store/playerStore'
import { fetchPreviewUrls } from '../services/appleMusic'
import { analyzeAudioBuffer } from '../services/analysisClient'
import { getFeatures, setFeatures, getAllKeys, makeTombstone } from '../services/featureCache'
import type { TrackFeatures } from '../services/featureCache'
import { getSharedAudioContext, beginAnalysis, endAnalysis } from '../lib/analysisShared'
import { mapPool } from '../lib/mapPool'
import type { Track } from '../types/music'

// How often buffered results are flushed into the store. Per-track store
// updates each copy the whole featuresMap (and re-render every subscriber) —
// over a 10k-track run that's 10k Map copies for no visible benefit.
const FLUSH_MS = 1000

// How many preview clips to fetch + decode + analyze in parallel.
const CONCURRENCY = 6

/**
 * Analyzes ALL library tracks in the background using a bounded concurrency
 * pool. Runs after a 10s delay so the active cassette's analysis gets priority.
 * Already-cached tracks are skipped.
 */
export function useBackgroundAnalysis(tracks: Track[]) {
  const bulkAddFeatures = usePlayerStore((s) => s.bulkAddFeatures)
  const startedRef = useRef(false)

  useEffect(() => {
    if (tracks.length === 0 || startedRef.current) return
    startedRef.current = true

    let cancelled = false

    // Buffer results and flush ~1/s (IndexedDB writes stay per-track; only the
    // store update is coalesced).
    const buf: TrackFeatures[] = []
    let flushTimer: ReturnType<typeof setTimeout> | null = null
    const flush = () => {
      flushTimer = null
      if (buf.length > 0) bulkAddFeatures(buf.splice(0))
    }
    const queueFeature = (f: TrackFeatures) => {
      buf.push(f)
      flushTimer ??= setTimeout(flush, FLUSH_MS)
    }

    async function run() {
      // Let the active-cassette analysis run first
      await new Promise((r) => setTimeout(r, 10_000))
      if (cancelled) return

      // Filter to uncached tracks only (one key read, not N round-trips)
      const have = await getAllKeys()
      const uncached = tracks.filter((t) => !have.has(t.id))
      if (cancelled || uncached.length === 0) return

      console.log(`[Kassette] Background analysis: ${uncached.length} tracks to analyze`)

      // Fetch preview URLs in chunks to avoid one giant request
      const CHUNK = 300
      const previewMap = new Map<string, string>()
      for (let i = 0; i < uncached.length; i += CHUNK) {
        if (cancelled) return
        const chunk = uncached.slice(i, i + CHUNK)
        const urls = await fetchPreviewUrls(chunk)
        for (const [id, url] of urls) previewMap.set(id, url)
      }

      const audioCtx = getSharedAudioContext()

      await mapPool(uncached, CONCURRENCY, async (track) => {
        // Skip if analyzed while we were fetching URLs (another lane / the
        // active-queue pass may have covered it).
        if (await getFeatures(track.id) !== null) return
        const url = previewMap.get(track.id)
        if (!url) {
          // Permanently unanalyzable (no catalog entry / no preview clip) —
          // tombstone so it is excluded from counts and never retried.
          const tomb = makeTombstone(track.id)
          await setFeatures(tomb).catch(() => {})
          queueFeature(tomb)
          return
        }
        if (!beginAnalysis(track.id)) return
        try {
          const res = await fetch(url)
          if (!res.ok) return
          const decoded = await audioCtx.decodeAudioData(await res.arrayBuffer())
          // degara: ~4-5x faster than multifeature — right trade for bulk
          // coverage (the active cassette's pass keeps multifeature accuracy).
          const features = await analyzeAudioBuffer(track.id, decoded, 'degara')
          await setFeatures(features)
          queueFeature(features)
        } catch {/* skip on CORS or decode error */}
        finally { endAnalysis(track.id) }
      }, () => cancelled)

      flush() // final partial batch
    }

    run()
    return () => {
      cancelled = true
      if (flushTimer) clearTimeout(flushTimer)
      flush() // don't drop already-analyzed results on unmount
    }
  }, [tracks, bulkAddFeatures])
}
