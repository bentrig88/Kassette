import { useState } from 'react'
import { configureMusicKit, authorize } from '../services/appleMusic'
import { useMusicStore } from '../store/musicStore'

export function AuthScreen() {
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const setAuthenticated = useMusicStore((s) => s.setAuthenticated)

  async function handleConnect() {
    setConnecting(true)
    setError(null)
    try {
      await configureMusicKit()
      await authorize()
      setAuthenticated(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed'
      setError(msg)
    } finally {
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
