import { useEffect, useRef } from 'react'
import type { AudioQuality } from '../types/music'

const CUTOFF: Record<AudioQuality, { frequency: number; Q: number }> = {
  lo:  { frequency: 1800, Q: 2.0 },
  mid: { frequency: 5500, Q: 1.2 },
  hi:  { frequency: 20000, Q: 0.7 },
}

interface Chain {
  context: AudioContext
  source: MediaElementAudioSourceNode
  filter: BiquadFilterNode
  analyser: AnalyserNode
  el: HTMLMediaElement
}

/**
 * Tries to build a Web Audio chain around a media element.
 * Returns null if the element is DRM-protected or already sourced.
 */
function buildChain(el: HTMLMediaElement, quality: AudioQuality): Chain | null {
  try {
    const context = new AudioContext()
    const source = context.createMediaElementSource(el)

    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.8

    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = CUTOFF[quality].frequency
    filter.Q.value = CUTOFF[quality].Q

    source.connect(analyser)
    source.connect(filter)
    filter.connect(context.destination)

    return { context, source, filter, analyser, el }
  } catch {
    return null
  }
}

export function useAudioFilter(quality: AudioQuality, isPlaying: boolean) {
  const chainRef = useRef<Chain | null>(null)
  const qualityRef = useRef(quality)
  qualityRef.current = quality
  const analyserRef = useRef<AnalyserNode | null>(null)

  // Keep the filter frequency in sync whenever quality changes
  useEffect(() => {
    if (!chainRef.current) return
    const { filter, context } = chainRef.current
    filter.frequency.setTargetAtTime(CUTOFF[quality].frequency, context.currentTime, 0.05)
    filter.Q.setTargetAtTime(CUTOFF[quality].Q, context.currentTime, 0.05)
  }, [quality])

  // Once playback starts, try to attach the Web Audio chain.
  // Only runs when isPlaying becomes true and no chain exists yet.
  // We retry each time isPlaying transitions (never permanently block).
  useEffect(() => {
    if (!isPlaying) return
    if (chainRef.current) {
      // Chain exists — just make sure the context is running
      if (chainRef.current.context.state === 'suspended') {
        chainRef.current.context.resume()
      }
      return
    }

    // Small delay so MusicKit finishes its own audio setup before we intercept
    const timer = setTimeout(() => {
      const allAudio = Array.from(document.querySelectorAll('audio'))
      const el = allAudio[0] ?? document.querySelector('video') as HTMLMediaElement | null
      if (!(el instanceof HTMLMediaElement)) return

      // If element swapped (new track), tear down old chain
      if (chainRef.current && (chainRef.current as Chain).el !== el) {
        try { chainRef.current.context.close() } catch { /* ignore */ }
        chainRef.current = null
      }
      if (chainRef.current) return

      const chain = buildChain(el, qualityRef.current)
      if (chain) {
        chainRef.current = chain
        analyserRef.current = chain.analyser
        console.log('[Kassette] Audio filter chain connected:', qualityRef.current)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [isPlaying])

  const filterActive = chainRef.current !== null
  return { filterActive, analyserRef }
}
