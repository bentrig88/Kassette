import { useState } from 'react'
import { configureMusicKit, authorize } from '../services/appleMusic'
import { VhsOverlay } from './VhsOverlay'
import { VhsDebug } from './VhsDebug'
import { useVhsParams } from '../hooks/useVhsParams'
import authBg from '../assets/auth/auth-background.jpg'
import authRedBack from '../assets/auth/auth-red-back.svg'
import authTape from '../assets/auth/auth-tape.png'
import authTapeShadow from '../assets/auth/auth-tape-shadow.png'
import authLogo from '../assets/auth/auth-logo.svg'

export function AuthScreen() {
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { vals, set } = useVhsParams()

  async function handleConnect() {
    setConnecting(true)
    setError(null)
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
    }
  }

  const stage = (
    <>
      <div className="auth-bg">
        <img src={authBg} alt="" />
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
            {connecting ? 'Connecting…' : 'Continue with Apple'}
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

      <VhsOverlay />
      <VhsDebug vals={vals} onChange={set} />
    </div>
  )
}
