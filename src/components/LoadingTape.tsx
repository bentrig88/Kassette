import { useEffect, useRef } from 'react'
import { imgLeftReelTape, imgRightReelTape } from '../assets/tapes/cassetteAssets'
import cassette0 from '../assets/tapes/cassette0-body-flat.png'
import logoUrl from '../assets/auth/auth-logo.svg'
import { TrackScreen } from './TrackScreen'
import type { ScreenTrack, ScreenMeta } from './TrackScreen'

interface Props {
  progress: number // 0–1
  now: ScreenTrack | null
  next: ScreenTrack | null
  nowMeta: ScreenMeta | null
  nextMeta: ScreenMeta | null
}

/**
 * The loading-screen cassette. Same layer stack as CassetteTapeBody (reels
 * behind a body PNG + window) but with the kassette logo, the shared LCD, and
 * a loading bar instead of the genre sticker. Reels spin endlessly (~90°/s).
 */
export function LoadingTape({ progress, now, next, nowMeta, nextMeta }: Props) {
  const leftReelRef = useRef<HTMLImageElement>(null)
  const rightReelRef = useRef<HTMLImageElement>(null)
  const angleRef = useRef(0)

  useEffect(() => {
    let lastTime: number | null = null
    let rafId: number
    function frame(time: number) {
      if (lastTime !== null) {
        const dt = Math.min((time - lastTime) / 1000, 0.1)
        angleRef.current += 90 * dt // 90°/s clockwise
      }
      lastTime = time
      const t = `rotate(${angleRef.current}deg)`
      if (leftReelRef.current) leftReelRef.current.style.transform = t
      if (rightReelRef.current) rightReelRef.current.style.transform = t
      rafId = requestAnimationFrame(frame)
    }
    rafId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafId)
  }, [])

  return (
    <div className="loading-tape">
      <div className="ct-body">
        {/* Reels — behind the body, visible through the window */}
        <img ref={leftReelRef} src={imgLeftReelTape} alt="" className="ct-abs ct-reel-left" draggable={false} />
        <img ref={rightReelRef} src={imgRightReelTape} alt="" className="ct-abs ct-reel-right" draggable={false} />

        {/* Body */}
        <div className="ct-abs ct-swapable">
          <img src={cassette0} alt="" draggable={false}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
        </div>

        {/* Window */}
        <div className="ct-abs ct-window" />

        {/* Shared LCD, scaled into the tape's screen area */}
        <div className="loading-tape-screen">
          <TrackScreen
            now={now}
            nowTime={0}
            nowDuration={0}
            nowProgress={0}
            nowMeta={nowMeta}
            next={next}
            nextMeta={nextMeta}
          />
        </div>

        {/* kassette logo */}
        <img src={logoUrl} alt="Kassette" className="loading-tape-logo" draggable={false} />

        {/* Loading bar */}
        <div className="loading-tape-bar">
          <div className="loading-tape-bar-fill" style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} />
        </div>
      </div>
    </div>
  )
}
