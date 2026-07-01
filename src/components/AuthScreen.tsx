import { useState } from 'react'
import { configureMusicKit, authorize } from '../services/appleMusic'
import { VhsOverlay } from './VhsOverlay'
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

      <VhsOverlay intensity={1} />
    </div>
  )
}
