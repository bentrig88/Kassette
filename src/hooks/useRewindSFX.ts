import { useEffect, useRef } from 'react'
import rewindStart from '../assets/sfx/SFX-rewinding-start.aac'
import rewindLoop from '../assets/sfx/SFX-rewinding-loop-2.aac'
import rewindEnd from '../assets/sfx/SFX-rewinding-end.aac'

export function useRewindSFX() {
  const startRef = useRef<HTMLAudioElement | null>(null)
  const loopRef = useRef<HTMLAudioElement | null>(null)
  const endRef = useRef<HTMLAudioElement | null>(null)

  // Hard-stop and release the chain on unmount (also kills a looping rewind
  // SFX if the component unmounts mid-hold).
  useEffect(() => () => {
    for (const ref of [startRef, loopRef, endRef]) {
      if (ref.current) { ref.current.onended = null; ref.current.pause(); ref.current = null }
    }
  }, [])

  function init() {
    if (startRef.current) return
    startRef.current = new Audio(rewindStart)
    loopRef.current = new Audio(rewindLoop)
    endRef.current = new Audio(rewindEnd)
    loopRef.current.loop = true
  }

  function play() {
    init()
    const start = startRef.current!
    const loop = loopRef.current!

    loop.pause()
    loop.currentTime = 0
    start.currentTime = 0
    start.onended = () => loop.play()
    start.play()
  }

  // onDone is called after the end sound finishes — use it to seek + unmute
  function stop(onDone: () => void) {
    init()
    const start = startRef.current!
    const loop = loopRef.current!
    const end = endRef.current!

    start.onended = null
    start.pause()
    loop.pause()
    loop.currentTime = 0

    end.currentTime = 0
    end.onended = () => {
      end.onended = null
      onDone()
    }
    end.play()
  }

  // Immediate hard-stop of the whole chain (no end sound, no callback) — used
  // when the interaction is abandoned (e.g. eject mid-rewind).
  function cancel() {
    if (!startRef.current) return
    startRef.current.onended = null
    startRef.current.pause()
    loopRef.current!.pause()
    loopRef.current!.currentTime = 0
    endRef.current!.onended = null
    endRef.current!.pause()
  }

  return { play, stop, cancel }
}
