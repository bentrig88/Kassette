import type { CSSProperties } from 'react'
import { useEffect, useRef } from 'react'
import type { Cassette } from '../types/music'
import * as CA from '../assets/cassetteAssets'

interface Props {
  cassette: Cassette
  // 0 = stopped, 1 = normal play, 3 = FF (3× CW), -3 = rewind (3× CCW)
  reelSpeed?: number
}

// The Figma canvas is 644×430 but the black cassette body occupies only the inner region:
//   origin (47, 52) → (597, 394)  =  550 × 342 px
// Using this bounding box as 100%×100% makes the cassette fill the container exactly.
const BX = 47, BY = 52   // body origin in Figma canvas px
const BW = 550, BH = 342 // body width / height in Figma canvas px

// Layers: [url, canvas_left, canvas_top, canvas_w, canvas_h] — bottom-to-top order.
// CSS background-image renders first entry on top, so we reverse before building the style.
const BODY_LAYERS: [string, number, number, number, number][] = [
  [CA.imgEars,               43,      286,   558,    82],
  [CA.imgSubtractBaseShadow, 47,       60,   550,   342],
  [CA.imgSubtractBase,       47,       52,   550,   342],
  [CA.imgPattern,            47,       52,   550,   342],
  [CA.imgOtherPattern,       75,       75,   494,   240],
  [CA.imgSubtractPattern,    167.95, 360.27, 308.098, 29.392],
  [CA.imgBottomBorder,       127,     321,   390,    73],
  [CA.imgScrewCenter,        312,     334,    20,    20],
  [CA.imgScrew,               56,      61,    22,    22], // TL
  [CA.imgScrew,              566,      61,    22,    22], // TR
  [CA.imgScrew,               56,     363,    22,    22], // BL
  [CA.imgScrew,              566,     363,    22,    22], // BR
  [CA.imgSideABottomRight,   517,     321,    53,    38],
  [CA.imgLogoTopRight,       504,      56,    53,    12],
  [CA.imgTdkLogo,            144,     262,   109,    22],
]

function f(n: number) { return n.toFixed(4) }

// Precomputed once at module load — single static object, no per-render cost.
const rev = [...BODY_LAYERS].reverse()
const BODY_STYLE: CSSProperties = {
  backgroundImage:    rev.map(([u])        => `url(${u})`).join(', '),
  backgroundRepeat:   rev.map(()           => 'no-repeat').join(', '),
  backgroundSize:     rev.map(([,,, w, h]) =>
    `calc(var(--cw) * ${f(w / BW)}) calc(var(--ch) * ${f(h / BH)})`
  ).join(', '),
  backgroundPosition: rev.map(([, l, t])  =>
    `left calc(var(--cw) * ${f((l - BX) / BW)}) top calc(var(--ch) * ${f((t - BY) / BH)})`
  ).join(', '),
}

export function CassetteTapeBody({ cassette, reelSpeed = 0 }: Props) {
  const leftReelRef = useRef<HTMLImageElement>(null)
  const rightReelRef = useRef<HTMLImageElement>(null)
  const angleRef = useRef(0)

  useEffect(() => {
    if (reelSpeed === 0) {
      // Clear transform so elements have no compositing layer during FLIP animation
      if (leftReelRef.current) leftReelRef.current.style.transform = ''
      if (rightReelRef.current) rightReelRef.current.style.transform = ''
      return
    }
    const direction = reelSpeed > 0 ? 1 : -1
    const degreesPerSecond = 90 * Math.abs(reelSpeed) // 90deg/s at speed=1
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
      {/* Part 1 & 2: reels sit behind the cassette body; they show through the
          transparent window hole in imgSubtractBase (the main body PNG) */}
      <img ref={leftReelRef} src={CA.imgLeftReelTape} alt="" className="ct-abs ct-reel-left" />
      <img ref={rightReelRef} src={CA.imgRightReelTape} alt="" className="ct-abs ct-reel-right" />

      {/* Part 3: swapable — all body layers stacked as CSS background-image (1 DOM element) */}
      <div className="ct-abs ct-swapable" style={BODY_STYLE} />

      {/* Part 4: window — pure CSS, no image asset */}
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
