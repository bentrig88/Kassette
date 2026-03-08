import { useRef } from 'react'
import sfxDoorOpen from '../assets/sfx/SFX-kassette-tape-door-openning.aac'
import sfxTapeInsert from '../assets/sfx/SFX-kassette-tape-inserting.aac'

export function useDoorSFX() {
  const doorOpenRef = useRef<HTMLAudioElement | null>(null)
  const tapeInsertRef = useRef<HTMLAudioElement | null>(null)

  function init() {
    if (doorOpenRef.current) return
    doorOpenRef.current = new Audio(sfxDoorOpen)
    tapeInsertRef.current = new Audio(sfxTapeInsert)
  }

  function playDoorOpen() {
    init()
    const sfx = doorOpenRef.current!
    sfx.currentTime = 0
    sfx.play()
  }

  function playTapeInsert() {
    init()
    const sfx = tapeInsertRef.current!
    sfx.currentTime = 0
    sfx.play()
  }

  return { playDoorOpen, playTapeInsert }
}
