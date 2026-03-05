import { useEffect, useRef } from 'react'
import type { AudioQuality } from '../types/music'

const CUTOFF: Record<AudioQuality, { frequency: number; Q: number }> = {
  lo:  { frequency: 1800, Q: 2.0 },  // heavily muffled, resonant — old worn tape
  mid: { frequency: 5500, Q: 1.2 },  // noticeably degraded
  hi:  { frequency: 20000, Q: 0.7 }, // full quality — essentially bypass
}

interface Chain {
  context: AudioContext
  filter: BiquadFilterNode
}

/**
 * Attempts to connect Web Audio API to MusicKit's audio element and apply
 * a low-pass filter to simulate tape quality grades.
 *
 * Returns true if the filter is active, false if DRM blocked it.
 * Apple Music DRM will block this in most browsers — the fallback is silent
 * (quality selector remains a visual-only control).
 */
export function useAudioFilter(quality: AudioQuality, isPlaying: boolean) {
  const chainRef = useRef<Chain | null>(null)
  const blockedRef = useRef(false)

  // Try to connect once when playback starts
  useEffect(() => {
    if (!isPlaying || blockedRef.current || chainRef.current) return

    const el = document.querySelector('audio') ?? document.querySelector('video')
    if (!(el instanceof HTMLMediaElement)) return

    try {
      const context = new AudioContext()
      const source = context.createMediaElementSource(el)
      const filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = CUTOFF[quality].frequency
      filter.Q.value = CUTOFF[quality].Q

      source.connect(filter)
      filter.connect(context.destination)

      chainRef.current = { context, filter }
    } catch {
      // DRM or browser policy blocked it — silent fallback
      blockedRef.current = true
    }
  }, [isPlaying]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update filter frequency when quality changes
  useEffect(() => {
    if (!chainRef.current) return
    const { filter, context } = chainRef.current
    filter.frequency.setTargetAtTime(CUTOFF[quality].frequency, context.currentTime, 0.08)
    filter.Q.setTargetAtTime(CUTOFF[quality].Q, context.currentTime, 0.08)
  }, [quality])

  // Resume AudioContext if suspended (browser autoplay policy)
  useEffect(() => {
    if (isPlaying && chainRef.current?.context.state === 'suspended') {
      chainRef.current.context.resume()
    }
  }, [isPlaying])

  return !blockedRef.current && chainRef.current !== null
}
