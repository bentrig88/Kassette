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

      {/* Horizontal-displacement filter (SVG) — warps the stage's real pixels */}
      <svg className="vhs-svg" aria-hidden="true">
        <filter id="vhs-displace" x="-5%" y="0%" width="110%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.000001 0.4" numOctaves={1} seed={2} result="n">
            <animate attributeName="seed" dur="0.9s" values="2;6;1;8;3" repeatCount="indefinite" calcMode="discrete" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="n" scale={8} xChannelSelector="R" yChannelSelector="A">
            <animate
              attributeName="scale"
              dur="6s"
              repeatCount="indefinite"
              keyTimes="0;0.28;0.30;0.34;0.6;0.62;0.66;1"
              values="6;6;34;6;6;54;6;6"
            />
          </feDisplacementMap>
        </filter>
      </svg>

      <VhsOverlay />
      <VhsDebug />
    </div>
  )
}
