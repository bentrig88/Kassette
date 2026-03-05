import { useEffect } from 'react'
import { useMusicStore } from './store/musicStore'
import { usePlayerStore } from './store/playerStore'
import {
  configureMusicKit,
  isAuthorized,
  fetchLibraryTracks,
  buildCassettes,
  getMusicKitInstance,
} from './services/appleMusic'
import { AuthScreen } from './components/AuthScreen'
import { CassetteCarousel } from './components/CassetteCarousel'
import { CassettePlayer } from './components/CassettePlayer'
import { PlaylistController } from './components/PlaylistController'
import './index.css'

export default function App() {
  const isAuthenticated = useMusicStore((s) => s.isAuthenticated)
  const isLoading = useMusicStore((s) => s.isLoading)
  const loadingProgress = useMusicStore((s) => s.loadingProgress)
  const error = useMusicStore((s) => s.error)
  const setAuthenticated = useMusicStore((s) => s.setAuthenticated)
  const setLoading = useMusicStore((s) => s.setLoading)
  const setLoadingProgress = useMusicStore((s) => s.setLoadingProgress)
  const setCassettes = useMusicStore((s) => s.setCassettes)
  const setError = useMusicStore((s) => s.setError)
  const isInserted = usePlayerStore((s) => s.isInserted)

  // On mount: try to restore existing MusicKit session
  useEffect(() => {
    async function tryRestore() {
      try {
        await configureMusicKit()
        if (isAuthorized()) {
          setAuthenticated(true)
        }
      } catch {
        // No token configured yet — user will see auth screen
      }
    }
    tryRestore()
  }, [setAuthenticated])

  // When authenticated, load library
  useEffect(() => {
    if (!isAuthenticated) return

    async function loadLibrary() {
      setLoading(true)
      setLoadingProgress(0)
      setError(null)

      try {
        const tracks = await fetchLibraryTracks((loaded, est) => {
          setLoadingProgress(Math.min(90, (loaded / est) * 100))
        })
        const cassettes = buildCassettes(tracks)
        setCassettes(cassettes)
        setLoadingProgress(100)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load library'
        setError(msg)
      } finally {
        setLoading(false)
      }
    }

    loadLibrary()
  }, [isAuthenticated, setLoading, setLoadingProgress, setError, setCassettes])

  if (!isAuthenticated) {
    return <AuthScreen />
  }

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-card">
          <div className="loading-title">Loading your library...</div>
          <div className="loading-bar-container">
            <div className="loading-bar" style={{ width: `${loadingProgress}%` }} />
          </div>
          <div className="loading-hint">Building your cassettes</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="loading-screen">
        <div className="loading-card">
          <div className="loading-title">Something went wrong</div>
          <p style={{ color: '#e74c3c', marginBottom: '1rem' }}>{error}</p>
          <button
            className="auth-button"
            onClick={() => {
              setError(null)
              setAuthenticated(false)
            }}
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      {!isInserted && (
        <div className="app-header">
          <span className="app-logo">Kassette</span>
          <button
            className="signout-btn"
            onClick={async () => {
              try {
                getMusicKitInstance().stop()
                await getMusicKitInstance().unauthorize()
              } catch {/* */}
              setAuthenticated(false)
              setCassettes([])
            }}
          >
            Sign out
          </button>
        </div>
      )}

      <div className={`app-main ${isInserted ? 'app-main--playing' : ''}`}>
        <CassetteCarousel />
        <CassettePlayer />
        <PlaylistController />
      </div>
    </div>
  )
}
