import { useRef } from 'react'
import sfxReg from '../assets/sfx/SFX-kassette-button-reg-pressed.aac'
import sfxEject from '../assets/sfx/SFX-kassette-button-eject-pressed.aac'

export function useButtonSFX() {
  const regRef = useRef<HTMLAudioElement | null>(null)
  const ejectRef = useRef<HTMLAudioElement | null>(null)

  function init() {
    if (regRef.current) return
    regRef.current = new Audio(sfxReg)
    ejectRef.current = new Audio(sfxEject)
  }

  function playReg() {
    init()
    const sfx = regRef.current!
    sfx.currentTime = 0
    sfx.play()
  }

  function playEject() {
    init()
    const sfx = ejectRef.current!
    sfx.currentTime = 0
    sfx.play()
  }

  return { playReg, playEject }
}
