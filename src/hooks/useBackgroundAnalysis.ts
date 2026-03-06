import { useEffect, useRef } from 'react'
import { usePlayerStore } from '../store/playerStore'
import { fetchPreviewUrls } from '../services/appleMusic'
import { analyzeBuffer } from '../services/audioAnalysis'
import { getFeatures, setFeatures } from '../services/featureCache'
import type { Track } from '../types/music'

/**
 * Slowly analyzes ALL library tracks in the background — one every 1s.
 * Runs after a 10s delay so the active cassette's analysis gets priority.
 * Already-cached tracks are skipped.
 */
export function useBackgroundAnalysis(tracks: Track[]) {
  const addFeatures = usePlayerStore((s) => s.addFeatures)
  const startedRef = useRef(false)

  useEffect(() => {
    if (tracks.length === 0 || startedRef.current) return
    startedRef.current = true

    let cancelled = false

    async function run() {
      // Let the active-cassette analysis run first
      await new Promise((r) => setTimeout(r, 10_000))
      if (cancelled) return

      // Filter to uncached tracks only
      const uncached: Track[] = []
      for (const t of tracks) {
        if (await getFeatures(t.id) === null) uncached.push(t)
      }
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

      const audioCtx = new AudioContext()

      for (const track of uncached) {
        if (cancelled) break
        // Skip if analyzed while we were fetching URLs
        if (await getFeatures(track.id) !== null) continue

        const url = previewMap.get(track.id)
        if (!url) continue

        try {
          const res = await fetch(url)
          if (!res.ok) continue
          const buf = await audioCtx.decodeAudioData(await res.arrayBuffer())
          const features = analyzeBuffer(track.id, buf)
          await setFeatures(features)
          addFeatures(features)
        } catch {/* skip on CORS or decode error */}

        // Gentle pace — 1s between tracks so we don't saturate the network
        await new Promise((r) => setTimeout(r, 1_000))
      }

      await audioCtx.close().catch(() => {})
    }

    run()
    return () => { cancelled = true }
  }, [tracks, addFeatures])
}
