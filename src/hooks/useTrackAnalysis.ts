import { useEffect, useRef } from 'react'
import { getFeatures, setFeatures } from '../services/featureCache'
import { createAnalysisState, feedFrame, computeFeatures } from '../services/audioAnalysis'
import { usePlayerStore } from '../store/playerStore'

const FEED_INTERVAL_MS = 50

/**
 * Analyzes the currently playing track using the AnalyserNode from useAudioFilter.
 * Results are stored in IndexedDB and the player store.
 * Each track is only analyzed once — subsequent plays load from cache.
 */
export function useTrackAnalysis(
  analyserRef: React.RefObject<AnalyserNode | null>,
  trackId: string | undefined,
  isPlaying: boolean
) {
  const addFeatures = usePlayerStore((s) => s.addFeatures)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stateRef = useRef(createAnalysisState())
  const analyzingIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!trackId || !isPlaying || !analyserRef.current) {
      clearInterval(intervalRef.current ?? undefined)
      intervalRef.current = null
      return
    }

    // If track changed, reset state
    if (analyzingIdRef.current !== trackId) {
      stateRef.current = createAnalysisState()
      analyzingIdRef.current = trackId

      // Check if already cached
      getFeatures(trackId).then((cached) => {
        if (cached) {
          addFeatures(cached)
          // Already analyzed — no need to run again
          analyzingIdRef.current = null
        }
      })
    }

    // Don't re-analyze if already cached (set to null above)
    if (analyzingIdRef.current === null) return

    intervalRef.current = setInterval(() => {
      const analyser = analyserRef.current
      const id = analyzingIdRef.current
      if (!analyser || !id) return

      feedFrame(stateRef.current, analyser, performance.now())

      const result = computeFeatures(id, stateRef.current)
      if (result) {
        const features = { id, ...result, analyzedAt: Date.now() }
        setFeatures(features)
        addFeatures(features)
        // Stop analyzing this track — we have enough data
        clearInterval(intervalRef.current ?? undefined)
        intervalRef.current = null
        analyzingIdRef.current = null
        console.log(`[Kassette] analyzed "${id}": BPM=${result.bpm} energy=${result.energy} mood=${result.mood}`)
      }
    }, FEED_INTERVAL_MS)

    return () => {
      clearInterval(intervalRef.current ?? undefined)
      intervalRef.current = null
    }
  }, [trackId, isPlaying, analyserRef, addFeatures])
}
