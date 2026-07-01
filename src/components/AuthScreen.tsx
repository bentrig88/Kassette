import { useEffect, useRef, useState } from 'react'
import { configureMusicKit, authorize } from '../services/appleMusic'
// import authBg from '../assets/auth/auth-background.jpg'
import authRedBack from '../assets/auth/auth-red-back.svg'
import authTape from '../assets/auth/auth-tape.png'
import authTapeShadow from '../assets/auth/auth-tape-shadow.png'
import authLogo from '../assets/auth/auth-logo.svg'

export function AuthScreen({ vhs }: { vhs: Record<string, number> }) {
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const vals = vhs

  // Randomized displacement-band motion: move to a random spot, pause, move
  // again (up or down), occasionally slip off-screen — driven via rAF so it's
  // unpredictable rather than a fixed CSS loop. Writes --vhs-band-top (%).
  const bandSpeedRef = useRef(vals.bandSpeed)
  const bandMinRef = useRef(vals.bandThickMin)
  const bandMaxRef = useRef(vals.bandThickMax)
  useEffect(() => {
    bandSpeedRef.current = vals.bandSpeed
    bandMinRef.current = vals.bandThickMin
    bandMaxRef.current = vals.bandThickMax
  }, [vals.bandSpeed, vals.bandThickMin, vals.bandThickMax])
  useEffect(() => {
    const root = document.documentElement
    let raf = 0
    let cancelled = false
    let pos = 120       // start hidden below the screen
    let from = 120
    let to = 120
    let phase: 'hold' | 'move' = 'hold'
    let phaseStart = 0
    let phaseDur = 0

    const rand = (a: number, b: number) => a + Math.random() * (b - a)

    function plan(now: number) {
      if (phase === 'move') {
        // just arrived — hold here for a random beat
        phase = 'hold'
        from = pos
        to = pos
        phaseDur = rand(500, 2800)
      } else {
        // choose a new destination (random, up or down) or slip off-screen
        phase = 'move'
        from = pos
        to = Math.random() < 0.28 ? (Math.random() < 0.5 ? -25 : 125) : rand(-10, 110)
        const dist = Math.abs(to - from)
        phaseDur = Math.max(180, (dist / 100) * bandSpeedRef.current * 1000 * rand(0.5, 1.5))
        // fresh random thickness for this pass (within min/max)
        const lo = Math.min(bandMinRef.current, bandMaxRef.current)
        const hi = Math.max(bandMinRef.current, bandMaxRef.current)
        root.style.setProperty('--vhs-band-h', `${rand(lo, hi).toFixed(2)}%`)
      }
      phaseStart = now
    }

    function frame(now: number) {
      if (cancelled) return
      if (phaseDur === 0) plan(now)
      const t = Math.min(1, (now - phaseStart) / phaseDur)
      if (phase === 'move') {
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2 // easeInOut
        pos = from + (to - from) * e
      }
      root.style.setProperty('--vhs-band-top', `${pos.toFixed(2)}%`)
      if (t >= 1) plan(now)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelled = true; cancelAnimationFrame(raf) }
  }, [])

  async function handleConnect() {
    setConnecting(true)
    setError(null)
    // MusicKit opens its auth window via window.open(); we don't call it
    // ourselves, so to center that popup we temporarily wrap window.open and
    // inject centered left/top (preserving MusicKit's requested width/height).
    const originalOpen = window.open.bind(window)
    window.open = ((url?: string | URL, target?: string, features?: string) => {
      const num = (key: string, fallback: number) => {
        const m = features?.match(new RegExp(`${key}\\s*=\\s*(\\d+)`))
        return m ? parseInt(m[1], 10) : fallback
      }
      const w = num('width', 500)
      const h = num('height', 700)
      const baseLeft = window.screenLeft ?? window.screenX
      const baseTop = window.screenTop ?? window.screenY
      const vw = window.innerWidth || document.documentElement.clientWidth || screen.width
      const vh = window.innerHeight || document.documentElement.clientHeight || screen.height
      const left = Math.round(baseLeft + (vw - w) / 2)
      const top = Math.round(baseTop + (vh - h) / 2)
      const centered = `${features ? features + ',' : ''}width=${w},height=${h},left=${left},top=${top}`
      return originalOpen(url as string, target ?? '_blank', centered)
    }) as typeof window.open
    try {
      await configureMusicKit()
      await authorize()
      // MusicKit's api pipeline doesn't attach the user token to library
      // requests in the session where the user just authorized — reload so the
      // app restores via the known-good path (see the auth-fix note in git log).
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed')
      setConnecting(false)
    } finally {
      window.open = originalOpen
    }
  }

  const stage = (
    <>
      <div className="auth-bg">
        {/* <img src={authBg} alt="" /> */}
      </div>
      <div className="auth-tape-wrap">
        <img src={authTapeShadow} alt="" className="auth-tape-shadow" />
        <img src={authTape} alt="" className="auth-tape" />
      </div>
      <img src={authRedBack} alt="" className="auth-red" />

      <div className="auth-content">
        <img src={authLogo} alt="Kassette" className="auth-logo" />
        <div className="auth-text">
          <h1 className="auth-title">Analog soul for a digital stream</h1>
          <p className="auth-body">
            Kassette brings back the lost art of the 90s mixtape, turning your Apple Music
            library into a tangible collection of tapes by genres. It restores the intentional,
            hands-on ritual of curating and playing your own music, recapturing that classic
            feeling of holding your favorite soundtrack in your hands.
          </p>
          <button className="auth-button" onClick={handleConnect} disabled={connecting}>
            {connecting ? (
              'Connecting…'
            ) : (
              <>
                Connect with{' '}
                <svg className="auth-apple" viewBox="0 0 384 512" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"
                  />
                </svg>{' '}
                Music
              </>
            )}
          </button>
          {error && <p className="auth-error">{error}</p>}
        </div>
      </div>
    </>
  )

  return (
    <div className="auth-screen">
      {/* Base content (interactive) */}
      <div className="auth-stage">{stage}</div>

      {/* Identical copy, horizontally displaced, revealed only inside a moving
          horizontal band via an animated clip-path (the tracking-error strip). */}
      <div className="auth-stage auth-stage--glitch" aria-hidden="true">{stage}</div>

      {/* Simple whole-layer horizontal displacement (applied to the glitch copy) */}
      <svg className="vhs-svg" aria-hidden="true">
        {/* Gentle always-on wobble (whole base stage) */}
        <filter id="vhs-global" x="-6%" y="-6%" width="112%" height="112%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency={`0.00001 ${vals.dispRough}`} numOctaves={1} seed={5} result="ng">
            <animate attributeName="seed" dur="0.6s" values="5;2;9;4;7" repeatCount="indefinite" calcMode="discrete" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="ng" scale={vals.globalDisp} xChannelSelector="R" yChannelSelector="G" />
        </filter>
        {/* Strong displacement for the moving band copy */}
        <filter id="vhs-shift" x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency={`0.00001 ${vals.dispRough}`} numOctaves={1} seed={3} result="n">
            <animate attributeName="seed" dur="0.4s" values="3;8;1;6;2" repeatCount="indefinite" calcMode="discrete" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="n" scale={vals.dispScale} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
    </div>
  )
}
