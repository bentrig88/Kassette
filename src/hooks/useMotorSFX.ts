import { useEffect, useRef } from 'react'
import motorLoop from '../assets/sfx/SFX-kassette-player-motor-loop.aac'

export function useMotorSFX(isPlaying: boolean) {
  const ctxRef = useRef<AudioContext | null>(null)
  const bufferRef = useRef<AudioBuffer | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  // Track desired play state so we can start if isPlaying was true when buffer loaded
  const wantsPlayRef = useRef(false)

  function startSource() {
    if (!bufferRef.current || !ctxRef.current || !gainRef.current) return
    if (sourceRef.current) return // already running

    const ctx = ctxRef.current
    if (ctx.state === 'suspended') ctx.resume()

    const source = ctx.createBufferSource()
    source.buffer = bufferRef.current
    source.loop = true
    source.connect(gainRef.current)
    source.start()
    sourceRef.current = source
  }

  function stopSource() {
    if (!sourceRef.current) return
    sourceRef.current.stop()
    sourceRef.current.disconnect()
    sourceRef.current = null
  }

  // Load and decode the audio buffer once
  useEffect(() => {
    let cancelled = false

    async function load() {
      const ctx = new AudioContext()
      ctxRef.current = ctx

      const gain = ctx.createGain()
      gain.gain.value = 0.4
      gain.connect(ctx.destination)
      gainRef.current = gain

      try {
        const res = await fetch(motorLoop)
        const arrayBuffer = await res.arrayBuffer()
        if (cancelled) return
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
        if (cancelled) return
        bufferRef.current = audioBuffer
        // If playback was requested before the buffer was ready, start now
        if (wantsPlayRef.current) startSource()
      } catch {
        // ignore load errors
      }
    }

    load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    wantsPlayRef.current = isPlaying
    if (isPlaying) {
      startSource()
    } else {
      stopSource()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying])

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopSource()
      ctxRef.current?.close()
      ctxRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
