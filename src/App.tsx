import { useEffect, useState } from 'react'
import type { Track } from './types/music'
import { useMusicStore } from './store/musicStore'
import { usePlayerStore } from './store/playerStore'
import {
  configureMusicKit,
  isAuthorized,
  fetchLibraryTracks,
  buildCassettes,
  getMusicKitInstance,
  getRawItemEntries,
  restoreRawItems,
} from './services/appleMusic'
import { loadLibrarySnapshot, saveLibrarySnapshot, clearLibrarySnapshot } from './services/libraryCache'
import { backgroundForGenre } from './assets/background/genreBackgrounds'
import { getAllFeatures } from './services/featureCache'
import { useBackgroundAnalysis } from './hooks/useBackgroundAnalysis'
import { AuthScreen } from './components/AuthScreen'
import { AuthIntro } from './components/AuthIntro'
import { CassetteCarousel } from './components/CassetteCarousel'
import { CassettePlayer } from './components/CassettePlayer'
import { PlaylistController } from './components/PlaylistController'
import { SceneBackground } from './components/SceneBackground'
import { LoadingScreen } from './components/LoadingScreen'
import { VhsOverlay } from './components/VhsOverlay'
import { VhsDebug } from './components/VhsDebug'
import { useVhsParams } from './hooks/useVhsParams'
import './index.css'

function usePlayerScale() {
  useEffect(() => {
    function update() {
      const scale = (window.innerHeight * 0.5) / 530
      document.documentElement.style.setProperty('--player-scale', String(scale))
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
}

export default function App() {
  usePlayerScale()
  const isAuthenticated = useMusicStore((s) => s.isAuthenticated)
  const isLoading = useMusicStore((s) => s.isLoading)
  const loadingProgress = useMusicStore((s) => s.loadingProgress)
  const error = useMusicStore((s) => s.error)
  const setAuthenticated = useMusicStore((s) => s.setAuthenticated)
  const setLoading = useMusicStore((s) => s.setLoading)
  const setLoadingProgress = useMusicStore((s) => s.setLoadingProgress)
  const setCassettes = useMusicStore((s) => s.setCassettes)
  const setAllTracks = useMusicStore((s) => s.setAllTracks)
  const allTracks = useMusicStore((s) => s.allTracks)
  const setError = useMusicStore((s) => s.setError)
  const cassettes = useMusicStore((s) => s.cassettes)
  const { vals: vhsVals, set: setVhs } = useVhsParams()
  const [introDone, setIntroDone] = useState(false)
  const [loadingComplete, setLoadingComplete] = useState(false)
  const [tracksSoFar, setTracksSoFar] = useState<Track[]>([])

  useBackgroundAnalysis(allTracks)
  const bulkAddFeatures = usePlayerStore((s) => s.bulkAddFeatures)

  // On mount: try to restore existing MusicKit session + load cached audio features
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

    getAllFeatures().then((cached) => {
      if (cached.size > 0) {
        bulkAddFeatures([...cached.values()])
        console.log(`[Kassette] Loaded ${cached.size} cached track features from IndexedDB`)
      }
    }).catch(() => {/* IndexedDB not available */})
  }, [setAuthenticated, bulkAddFeatures])

  // When authenticated, load library
  useEffect(() => {
    if (!isAuthenticated) return

    // Compare by ordered ids — Apple returns a stable library order, so any
    // add/remove/reorder shows up as a mismatch.
    function sameLibrary(a: Track[], b: Track[]): boolean {
      return a.length === b.length && a.every((t, i) => t.id === b[i].id)
    }

    async function loadLibrary() {
      setLoading(true)
      setLoadingProgress(0)
      setError(null)

      // Cache-first: render cassettes instantly from the IndexedDB snapshot,
      // then revalidate against the API in the background. The snapshot also
      // restores the raw MediaItems (cloudId) so playback works from cache.
      const cached = await loadLibrarySnapshot()
      if (cached && cached.tracks.length > 0) {
        restoreRawItems(cached.rawItems)
        setCassettes(buildCassettes(cached.tracks))
        setAllTracks(cached.tracks)
        setTracksSoFar(cached.tracks)
        setLoadingProgress(100)
        setLoading(false)

        fetchLibraryTracks()
          .then((fresh) => {
            saveLibrarySnapshot(fresh, getRawItemEntries())
            if (!sameLibrary(fresh, cached.tracks)) {
              setCassettes(buildCassettes(fresh))
              setAllTracks(fresh)
            }
          })
          .catch(() => {/* revalidation is best-effort; cache already rendered */})
        return
      }

      try {
        const tracks = await fetchLibraryTracks((loaded, est, soFar) => {
          setLoadingProgress(Math.min(95, (loaded / est) * 95))
          setTracksSoFar([...soFar])
        })
        const cassettes = buildCassettes(tracks)
        setCassettes(cassettes)
        setAllTracks(tracks)
        setLoadingProgress(100)
        saveLibrarySnapshot(tracks, getRawItemEntries())
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load library'
        setError(msg)
      } finally {
        setLoading(false)
      }
    }

    loadLibrary()
  }, [isAuthenticated, setLoading, setLoadingProgress, setError, setCassettes, setAllTracks])

  const handleSignOut = async () => {
    try {
      getMusicKitInstance().stop()
      await getMusicKitInstance().unauthorize()
    } catch {/* */}
    clearLibrarySnapshot() // don't flash this library to the next account
    setAuthenticated(false)
    setCassettes([])
    setIntroDone(false) // replay the intro loader next time auth is shown
    setLoadingComplete(false)
    setTracksSoFar([])
  }

  let screen
  if (!isAuthenticated) {
    screen = (
      <>
        <AuthScreen vhs={vhsVals} />
        {!introDone && <AuthIntro onDone={() => setIntroDone(true)} />}
      </>
    )
  } else if (error) {
    screen = (
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
  } else if (cassettes.length > 0) {
    screen = (
      <>
        <SceneBackground />
        <div className="app">
          <button
            className="signout-btn signout-btn--floating"
            onClick={handleSignOut}
          >
            Sign out
          </button>

          <div className="app-main">
            <CassetteCarousel />
            <div className="player-filter-wrapper">
              <div className="player-scale-container">
                <div className="np-player-wrapper">
                  <CassettePlayer />
                </div>
              </div>
              <PlaylistController />
            </div>
          </div>
        </div>
      </>
    )
  } else if (loadingComplete) {
    // Authed, load finished, no error, but zero cassettes — no track matched a
    // genre. The LoadingScreen overlay has unmounted, so show an empty state
    // instead of a blank viewport.
    screen = (
      <div className="loading-screen">
        <div className="loading-card">
          <div className="loading-title">No cassettes to show</div>
          <p style={{ marginBottom: '1rem' }}>
            None of the tracks in your library matched a genre we recognize.
          </p>
          <button className="auth-button" onClick={handleSignOut}>Sign out</button>
        </div>
      </div>
    )
  }
  // While the library is still fetching (authed, no error, cassettes not built
  // yet), `screen` stays undefined — the opaque LoadingScreen overlay covers the
  // viewport. Gating the player on cassettes.length > 0 also avoids a one-render
  // race where the player would mount before loadLibrary populates the store.

  return (
    <>
      {screen}
      {isAuthenticated && !error && !loadingComplete && (
        <LoadingScreen
          libraryProgress={loadingProgress}
          libraryDone={!isLoading && loadingProgress >= 100}
          tracksPool={tracksSoFar}
          firstBackgroundUrl={cassettes.length > 0 ? backgroundForGenre(cassettes[0].genre) : null}
          onComplete={() => setLoadingComplete(true)}
        />
      )}
      {/* VHS overlay + tuning panel — on top of every screen, click-through.
          Animated only on the auth state; static on loading + player screens. */}
      <VhsOverlay animate={!isAuthenticated} />
      <VhsDebug vals={vhsVals} onChange={setVhs} />
    </>
  )
}
