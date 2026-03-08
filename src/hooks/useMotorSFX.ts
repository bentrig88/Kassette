import { useEffect, useRef } from 'react'
import motorLoop from '../assets/sfx/SFX-kassette-player-motor-loop.aac'

export function useMotorSFX(isPlaying: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  function getAudio() {
    if (!audioRef.current) {
      audioRef.current = new Audio(motorLoop)
      audioRef.current.loop = true
      audioRef.current.volume = 0.4
    }
    return audioRef.current
  }

  useEffect(() => {
    const audio = getAudio()
    if (isPlaying) {
      audio.play().catch(() => {/* autoplay blocked — ignore */})
    } else {
      audio.pause()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying])

  // Stop and reset on unmount
  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
    }
  }, [])
}
