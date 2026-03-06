import { useEffect, useRef } from 'react'
import type { AudioQuality } from '../types/music'

const CUTOFF: Record<AudioQuality, { frequency: number; Q: number }> = {
  lo:  { frequency: 1800, Q: 2.0 },
  mid: { frequency: 5500, Q: 1.2 },
  hi:  { frequency: 20000, Q: 0.7 },
}

interface Chain {
  context: AudioContext
  filter: BiquadFilterNode
  analyser: AnalyserNode
}

export function useAudioFilter(quality: AudioQuality, isPlaying: boolean) {
  const chainRef = useRef<Chain | null>(null)
  const blockedRef = useRef(false)
  // Exposed so useTrackAnalysis can read audio data
  const analyserRef = useRef<AnalyserNode | null>(null)

  useEffect(() => {
    if (!isPlaying || blockedRef.current || chainRef.current) return

    const el = document.querySelector('audio') ?? document.querySelector('video')
    if (!(el instanceof HTMLMediaElement)) return

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

      // source → analyser (tap for analysis)
      // source → filter → destination (playback chain)
      source.connect(analyser)
      source.connect(filter)
      filter.connect(context.destination)

      chainRef.current = { context, filter, analyser }
      analyserRef.current = analyser
    } catch {
      blockedRef.current = true
    }
  }, [isPlaying]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!chainRef.current) return
    const { filter, context } = chainRef.current
    filter.frequency.setTargetAtTime(CUTOFF[quality].frequency, context.currentTime, 0.08)
    filter.Q.setTargetAtTime(CUTOFF[quality].Q, context.currentTime, 0.08)
  }, [quality])

  useEffect(() => {
    if (isPlaying && chainRef.current?.context.state === 'suspended') {
      chainRef.current.context.resume()
    }
  }, [isPlaying])

  const filterActive = !blockedRef.current && chainRef.current !== null
  return { filterActive, analyserRef }
}
