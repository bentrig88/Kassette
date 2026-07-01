import { useEffect, useMemo, useRef } from 'react'
import { usePlayerStore } from '../store/playerStore'
import { fetchPreviewUrls } from '../services/appleMusic'
import { analyzeAudioBuffer } from '../services/analysisClient'
import { getFeatures, setFeatures } from '../services/featureCache'
import { getSharedAudioContext, beginAnalysis, endAnalysis } from '../lib/analysisShared'
import { mapPool } from '../lib/mapPool'
import type { Track } from '../types/music'

// How many preview clips to fetch + decode + analyze in parallel.
const CONCURRENCY = 6

/**
 * Analyzes the active queue's tracks using their 30s Apple Music preview clips,
 * with a bounded concurrency pool. Runs as soon as a cassette is inserted.
 * Results are cached in IndexedDB so each track is only analyzed once.
 */
export function usePreviewAnalysis(tracks: Track[]) {
  const addFeatures = usePlayerStore((s) => s.addFeatures)
  const tracksRef = useRef(tracks)

  // Mirror the latest tracks into a ref so the analysis loop reads the current
  // queue. (Updated in an effect — never during render.)
  useEffect(() => { tracksRef.current = tracks }, [tracks])

  // Re-run only when the SET of track ids changes — NOT on reorder. This way
  // subgenre filtering (different tracks) triggers fresh analysis, while slider
  // re-sorts (same tracks, new order) don't restart it.
  const idKey = useMemo(() => tracks.map((t) => t.id).slice().sort().join('|'), [tracks])

  useEffect(() => {
    const queue = tracksRef.current
    if (queue.length === 0) return
    let cancelled = false

    async function run() {
      // Skip tracks already in IndexedDB
      const uncached = (
        await Promise.all(queue.map(async (t) => ((await getFeatures(t.id)) ? null : t)))
      ).filter((t): t is Track => t !== null)

      if (cancelled || uncached.length === 0) return

      // Fetch preview URLs for uncached tracks
      const previewMap = await fetchPreviewUrls(uncached)
      if (cancelled) return

      const audioCtx = getSharedAudioContext()

      await mapPool(uncached, CONCURRENCY, async (track) => {
        const url = previewMap.get(track.id)
        if (!url) return
        if (!beginAnalysis(track.id)) return   // another pass owns it
        try {
          const res = await fetch(url)
          if (!res.ok) return
          const arrayBuffer = await res.arrayBuffer()
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
          const features = await analyzeAudioBuffer(track.id, audioBuffer)
          await setFeatures(features)
          addFeatures(features)
        } catch {/* skip on CORS or decode error */}
        finally { endAnalysis(track.id) }
      }, () => cancelled)
    }

    run()
    // Changing queue (new idKey) cancels the in-flight run and starts a fresh
    // one for the new set, so a subgenre filter's tracks get analyzed promptly.
    return () => { cancelled = true }
  }, [idKey, addFeatures])
}
