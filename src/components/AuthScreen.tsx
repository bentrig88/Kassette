import { useState } from 'react'
import { configureMusicKit, authorize } from '../services/appleMusic'
import { VhsOverlay } from './VhsOverlay'
import { VhsDebug } from './VhsDebug'
import authBg from '../assets/auth/auth-background.jpg'
import authRedBack from '../assets/auth/auth-red-back.svg'
import authTape from '../assets/auth/auth-tape.png'
import authTapeShadow from '../assets/auth/auth-tape-shadow.png'
import authLogo from '../assets/auth/auth-logo.svg'

export function AuthScreen() {
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="auth-screen">
      {/* Stage — gets the horizontal-displacement (analog wobble/tear) filter */}
      <div className="auth-stage">
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
      </div>

      {/* Displacement confined to a horizontal band that sweeps in/out of the
          screen at irregular times. The map is neutral gray (= no displacement)
          everywhere except a moving feFlood band filled with turbulence. */}
      <svg className="vhs-svg" aria-hidden="true">
        <filter id="vhs-displace" x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
          <feFlood floodColor="#808080" result="neutral" />
          <feTurbulence type="fractalNoise" baseFrequency="0.00001 0.6" numOctaves={1} seed={4} result="turb">
            <animate attributeName="seed" dur="0.5s" values="4;9;2;7;1" repeatCount="indefinite" calcMode="discrete" />
          </feTurbulence>
          {/* force turbulence alpha = 1 so the band fully replaces the neutral map */}
          <feColorMatrix in="turb" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0 1" result="turbO" />
          {/* the moving band mask (white strip, transparent elsewhere) */}
          <feFlood floodColor="#ffffff" x="0%" width="100%" y="-20%" height="9%" result="bandmask">
            <animate
              attributeName="y"
              dur="8.5s"
              repeatCount="indefinite"
              keyTimes="0;0.12;0.16;0.34;0.55;0.60;0.78;0.84;1"
              values="-20%;-20%;75%;70%;-20%;-20%;40%;38%;110%"
            />
            <animate
              attributeName="height"
              dur="8.5s"
              repeatCount="indefinite"
              keyTimes="0;0.16;0.34;0.60;0.78;1"
              values="7%;7%;13%;9%;16%;7%"
            />
          </feFlood>
          <feComposite in="turbO" in2="bandmask" operator="in" result="bandturb" />
          <feMerge result="map">
            <feMergeNode in="neutral" />
            <feMergeNode in="bandturb" />
          </feMerge>
          <feDisplacementMap in="SourceGraphic" in2="map" scale={35} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>

      <VhsOverlay />
      <VhsDebug />
    </div>
  )
}
