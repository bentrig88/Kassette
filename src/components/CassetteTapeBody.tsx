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
// Rendered as stacked <img> elements so SVG-internal url(#id) refs (gradients, filters)
// resolve correctly. CSS background-image breaks those refs in Chrome.
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
  [CA.imgTdkLogo,            165,     255,   327,    66],
]

function f(n: number) { return n.toFixed(4) }

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
      {/* Part 1 & 2: reels — behind the body, visible through the transparent window */}
      <img ref={leftReelRef} src={CA.imgLeftReelTape} alt="" className="ct-abs ct-reel-left" />
      <img ref={rightReelRef} src={CA.imgRightReelTape} alt="" className="ct-abs ct-reel-right" />

      {/* Part 3: swapable — stacked <img> elements so SVG url(#id) refs work correctly */}
      <div className="ct-abs ct-swapable">
        {BODY_LAYERS.map(([url, l, t, w, h], i) => (
          <img
            key={i}
            src={url}
            alt=""
            style={{
              position: 'absolute',
              left:   `calc(var(--cw) * ${f((l - BX) / BW)})`,
              top:    `calc(var(--ch) * ${f((t - BY) / BH)})`,
              width:  `calc(var(--cw) * ${f(w / BW)})`,
              height: `calc(var(--ch) * ${f(h / BH)})`,
              display: 'block',
            }}
          />
        ))}
      </div>

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
