import { useEffect, useRef } from 'react'
import { usePlayerStore } from '../store/playerStore'
import { fetchPreviewUrls } from '../services/appleMusic'
import { analyzeAudioBuffer } from '../services/analysisClient'
import { getFeatures, setFeatures } from '../services/featureCache'
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
  const runningRef = useRef(false)
  const tracksRef = useRef(tracks)

  // Mirror the latest tracks into a ref so the long-running analysis loop can
  // read the current queue without restarting.
  useEffect(() => { tracksRef.current = tracks }, [tracks])

  useEffect(() => {
    if (tracks.length === 0 || runningRef.current) return
    runningRef.current = true
    let cancelled = false

    async function run() {
      const queue = tracksRef.current

      // Skip tracks already in IndexedDB
      const uncached = (
        await Promise.all(queue.map(async (t) => ((await getFeatures(t.id)) ? null : t)))
      ).filter((t): t is Track => t !== null)

      if (cancelled || uncached.length === 0) {
        runningRef.current = false
        return
      }

      // Fetch preview URLs for uncached tracks
      const previewMap = await fetchPreviewUrls(uncached)

      const audioCtx = new AudioContext()

      await mapPool(uncached, CONCURRENCY, async (track) => {
        const url = previewMap.get(track.id)
        if (!url) return

        try {
          const res = await fetch(url)
          if (!res.ok) return
          const arrayBuffer = await res.arrayBuffer()
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
          const features = await analyzeAudioBuffer(track.id, audioBuffer)
          await setFeatures(features)
          addFeatures(features)
        } catch {
          // CORS or decode error — skip this track
        }
      }, () => cancelled)

      await audioCtx.close().catch(() => {})
      runningRef.current = false
    }

    run()
    return () => { cancelled = true }
  }, [tracks, addFeatures])
}
