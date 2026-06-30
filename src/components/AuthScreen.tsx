import { useState } from 'react'
import { configureMusicKit, authorize } from '../services/appleMusic'

export function AuthScreen() {
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConnect() {
    setConnecting(true)
    setError(null)
    try {
      await configureMusicKit()
      await authorize()
      // In the session where the user *just* authorized, MusicKit's api pipeline
      // does not attach the Music User Token to /v1/me/library/* requests, so an
      // immediate library fetch 403s (re-authorizing in-session doesn't help —
      // only a fresh page load does). authorize() has already persisted the
      // token, so reload to restore the session via the known-good path:
      // configure() → isAuthorized() → loadLibrary() with the token present.
      window.location.reload()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed'
      setError(msg)
      setConnecting(false)
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="cassette-icon">&#9646;&#9646;</div>
        </div>
        <h1 className="auth-title">Kassette</h1>
        <p className="auth-subtitle">Your Apple Music library, on tape.</p>
        <button
          className="auth-button"
          onClick={handleConnect}
          disabled={connecting}
        >
          {connecting ? 'Connecting...' : 'Connect Apple Music'}
        </button>
        {error && <p className="auth-error">{error}</p>}
        <p className="auth-hint">
          You'll be redirected to sign in with your Apple ID.
        </p>
      </div>
    </div>
  )
}
