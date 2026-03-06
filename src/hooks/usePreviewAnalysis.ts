import { useEffect, useRef } from 'react'
import { usePlayerStore } from '../store/playerStore'
import { fetchPreviewUrls } from '../services/appleMusic'
import { analyzeBuffer } from '../services/audioAnalysis'
import { getFeatures, setFeatures } from '../services/featureCache'
import type { Track } from '../types/music'

/**
 * Analyzes tracks using their 30s Apple Music preview clips.
 * Runs in the background after the cassette queue is loaded.
 * Results are cached in IndexedDB so each track is only analyzed once.
 */
export function usePreviewAnalysis(tracks: Track[]) {
  const addFeatures = usePlayerStore((s) => s.addFeatures)
  const runningRef = useRef(false)
  const tracksRef = useRef(tracks)
  tracksRef.current = tracks

  useEffect(() => {
    if (tracks.length === 0 || runningRef.current) return
    runningRef.current = true

    async function run() {
      const queue = tracksRef.current

      // Skip tracks already in IndexedDB
      const uncached = (
        await Promise.all(queue.map(async (t) => ((await getFeatures(t.id)) ? null : t)))
      ).filter((t): t is Track => t !== null)

      if (uncached.length === 0) {
        runningRef.current = false
        return
      }

      // Fetch preview URLs for uncached tracks
      const previewMap = await fetchPreviewUrls(uncached)

      const audioCtx = new AudioContext()

      for (const track of uncached) {
        const url = previewMap.get(track.id)
        if (!url) continue

        try {
          const res = await fetch(url)
          if (!res.ok) continue
          const arrayBuffer = await res.arrayBuffer()
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
          const features = analyzeBuffer(track.id, audioBuffer)
          await setFeatures(features)
          addFeatures(features)
          console.log(`[Kassette] analyzed "${track.name}": BPM=${features.bpm} energy=${features.energy} mood=${features.mood}`)
        } catch {
          // CORS or decode error — skip this track
        }

        // Small pause between tracks to avoid saturating the network
        await new Promise((r) => setTimeout(r, 100))
      }

      await audioCtx.close()
      runningRef.current = false
    }

    run()
  }, [tracks, addFeatures])
}
