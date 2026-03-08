import { useEffect, useRef } from 'react'
import type { Cassette } from '../types/music'
import * as CA from '../assets/tapes/cassetteAssets'

interface Props {
  cassette: Cassette
  // 0 = stopped, 1 = normal play, 3 = FF (3× CW), -3 = rewind (3× CCW)
  reelSpeed?: number
}

export function CassetteTapeBody({ cassette, reelSpeed = 0 }: Props) {
  const leftReelRef = useRef<HTMLImageElement>(null)
  const rightReelRef = useRef<HTMLImageElement>(null)
  const angleRef = useRef(0)

  useEffect(() => {
    if (reelSpeed === 0) {
      if (leftReelRef.current) leftReelRef.current.style.transform = ''
      if (rightReelRef.current) rightReelRef.current.style.transform = ''
      return
    }
    const direction = reelSpeed > 0 ? 1 : -1
    const degreesPerSecond = 90 * Math.abs(reelSpeed)
    let lastTime: number | null = null
    let rafId: number
    function frame(time: number) {
      if (lastTime !== null) {
        const dt = Math.min((time - lastTime) / 1000, 0.1)
        angleRef.current += degreesPerSecond * direction * dt
      }
      lastTime = time
      const t = `rotate(${angleRef.current}deg)`
      if (leftReelRef.current) leftReelRef.current.style.transform = t
      if (rightReelRef.current) rightReelRef.current.style.transform = t
      rafId = requestAnimationFrame(frame)
    }
    rafId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafId)
  }, [reelSpeed])

  return (
    <div className="ct-body">
      {/* Reels — behind the body, visible through the transparent window */}
      <img ref={leftReelRef} src={CA.imgLeftReelTape} alt="" className="ct-abs ct-reel-left" />
      <img ref={rightReelRef} src={CA.imgRightReelTape} alt="" className="ct-abs ct-reel-right" />

      {/* Body — genre-to-style mapping defined in cassetteAssets.ts */}
      <div className="ct-abs ct-swapable">
        <img
          src={CA.genreBodyMap[cassette.genre]}
          alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
        />
      </div>

      {/* Window — pure CSS, no image asset */}
      <div className="ct-abs ct-window" />

      {/* Sticker — HTML/CSS, dynamic genre color + text */}
      <div className="ct-abs ct-sticker">
        <div className="ct-sticker-bar" style={{ background: cassette.color }} />
        <div className="ct-sticker-white">
          <div className="ct-sticker-a">A</div>
          <div className="ct-sticker-info">
            <span className="ct-sticker-genre">{cassette.genre}</span>
            <span className="ct-sticker-track">{cassette.tracks.length} tracks</span>
          </div>
        </div>
        <div className="ct-sticker-bar" style={{ background: cassette.color }} />
      </div>
    </div>
  )
}
