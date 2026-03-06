import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { usePlayerStore } from '../store/playerStore'
import type { TrackFeatures } from '../services/featureCache'
import { getMusicKitInstance, playQueueFrom } from '../services/appleMusic'
import { useVUMeter } from '../hooks/useVUMeter'
import { useAudioFilter } from '../hooks/useAudioFilter'
import { useRewindSFX } from '../hooks/useRewindSFX'
import { usePreviewAnalysis } from '../hooks/usePreviewAnalysis'
import type { AudioQuality } from '../types/music'

export function CassettePlayer() {
  const {
    currentCassette,
    queuedTracks,
    isInserted,
    playbackState,
    volume,
    quality,
    currentTrackIndex,
    currentTime,
    duration,
    ejectCassette,
    setPlaybackState,
    setVolume,
    setQuality,
    setCurrentTrackIndex,
    setCurrentTime,
    setDuration,
    setTempoFilter,
    setEnergyFilter,
    setMoodFilter,
  } = usePlayerStore()

  const isPlaying = playbackState === 'playing'
  const bars = useVUMeter(isPlaying)
  const { filterActive } = useAudioFilter(quality, isPlaying)
  const rewindSFX = useRewindSFX()

  // Kept as refs so event-listener closures always read the latest value
  const queuedTracksRef = useRef(queuedTracks)
  queuedTracksRef.current = queuedTracks
  const currentCassetteRef = useRef(currentCassette)
  currentCassetteRef.current = currentCassette
  const currentTrackIndexRef = useRef(currentTrackIndex)
  currentTrackIndexRef.current = currentTrackIndex

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Sync MusicKit events
  useEffect(() => {
    if (!isInserted) return

    let music: MusicKit.MusicKitInstance
    try {
      music = getMusicKitInstance()
    } catch {
      return
    }

    const onStateChange = () => {
      const state = music.playbackState
      const states = MusicKit.PlaybackStates
      if (state === states.playing) setPlaybackState('playing')
      else if (state === states.paused) setPlaybackState('paused')
      else if (state === states.stopped) setPlaybackState('stopped')
      else if (state === states.loading || state === states.waiting) setPlaybackState('loading')
      else if (state === states.completed) {
        // MusicKit's loaded window is exhausted — advance to next from our sorted queue
        setPlaybackState('stopped')
        const q = queuedTracksRef.current.length > 0
          ? queuedTracksRef.current
          : (currentCassetteRef.current?.tracks ?? [])
        const nextIdx = currentTrackIndexRef.current + 1
        if (nextIdx < q.length) {
          playQueueFrom(q, nextIdx).catch(() => {})
        }
      }
    }

    const onNowPlayingChange = () => {
      const nowId = music.nowPlayingItem?.id
      const q = queuedTracksRef.current.length > 0
        ? queuedTracksRef.current
        : (currentCassetteRef.current?.tracks ?? [])
      const idx = nowId ? q.findIndex((t) => t.id === nowId) : -1
      setCurrentTrackIndex(idx >= 0 ? idx : 0)
      setDuration(music.currentPlaybackDuration)
      setCurrentTime(0)
    }

    music.addEventListener('playbackStateDidChange', onStateChange)
    music.addEventListener('nowPlayingItemDidChange', onNowPlayingChange)

    return () => {
      music.removeEventListener('playbackStateDidChange', onStateChange)
      music.removeEventListener('nowPlayingItemDidChange', onNowPlayingChange)
    }
  }, [isInserted, setPlaybackState, setCurrentTrackIndex, setDuration, setCurrentTime])

  // Poll playback time
  useEffect(() => {
    if (!isPlaying) {
      if (tickRef.current) clearInterval(tickRef.current)
      return
    }
    tickRef.current = setInterval(() => {
      try {
        const music = getMusicKitInstance()
        setCurrentTime(music.currentPlaybackTime)
        setDuration(music.currentPlaybackDuration)
      } catch {/* ignore */}
    }, 500)
    return () => {
      if (tickRef.current) clearInterval(tickRef.current)
    }
  }, [isPlaying, setCurrentTime, setDuration])

  // Sync volume to MusicKit
  useEffect(() => {
    try {
      getMusicKitInstance().volume = volume
    } catch {/* not yet configured */}
  }, [volume])

  async function handlePlay() {
    try {
      const music = getMusicKitInstance()
      // play() requires PlayActivity to be initialized — calling stop() ensures that.
      // Skip if already paused (stop() would reset position).
      if (music.playbackState !== MusicKit.PlaybackStates.paused) {
        music.stop()
      }
      await music.play()
    } catch (e) {
      console.error(e)
    }
  }

  function handlePause() {
    try {
      getMusicKitInstance().pause()
    } catch {/* */}
  }

  function handleStop() {
    try {
      const music = getMusicKitInstance()
      music.stop()
      setCurrentTime(0)
    } catch {/* */}
  }

  const fbPressRef = useRef<{ startedAt: number; positionAt: number } | null>(null)

  function getAudioEl() {
    return document.querySelector('audio') as HTMLAudioElement | null
  }

  function startFF() {
    const el = getAudioEl()
    if (el) el.playbackRate = 8
  }

  function stopFF() {
    const el = getAudioEl()
    if (el) el.playbackRate = 1
  }

  function startFB() {
    const el = getAudioEl()
    if (el) el.muted = true
    fbPressRef.current = {
      startedAt: Date.now(),
      positionAt: getMusicKitInstance().currentPlaybackTime,
    }
    rewindSFX.play()
  }

  function stopFB() {
    if (!fbPressRef.current) return
    const heldSeconds = (Date.now() - fbPressRef.current.startedAt) / 1000
    const rewind = heldSeconds * 8
    const target = Math.max(0, fbPressRef.current.positionAt - rewind)
    fbPressRef.current = null

    rewindSFX.stop(() => {
      try {
        getMusicKitInstance().seekToTime(target)
      } catch {/* */}
      const el = getAudioEl()
      if (el) el.muted = false
    })
  }

  async function handleEject() {
    fbPressRef.current = null
    stopFF()
    try {
      getMusicKitInstance().stop()
    } catch {/* */}
    ejectCassette()
  }

  const featuresMap = usePlayerStore((s) => s.featuresMap)

  const displayQueue = queuedTracks.length > 0 ? queuedTracks : (currentCassette?.tracks ?? [])
  usePreviewAnalysis(displayQueue)
  const currentTrack = displayQueue[currentTrackIndex]
  const currentFeatures: TrackFeatures | undefined = currentTrack ? featuresMap.get(currentTrack.id) : undefined
  const nextTrack = displayQueue[currentTrackIndex + 1]

  // Snap sliders to current track's features — purely informational, does not re-sort
  useEffect(() => {
    if (!currentTrack) return
    const f = featuresMap.get(currentTrack.id)
    if (!f) return
    const bpmNorm = Math.round(Math.min(100, Math.max(0, ((f.bpm - 60) / 120) * 100)))
    setTempoFilter(bpmNorm)
    setEnergyFilter(f.energy)
    setMoodFilter(f.mood)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, setTempoFilter, setEnergyFilter, setMoodFilter])

  const qualityLabels: AudioQuality[] = ['lo', 'mid', 'hi']

  const progress = duration > 0 ? currentTime / duration : 0
  const leftRotation = isPlaying ? progress * 360 : 0
  const rightRotation = isPlaying ? (1 - progress) * 360 : 0

  return (
    <div className="player-wrapper">
      <div className="player-body">
        {/* Left panel: VU meter + Volume */}
        <div className="player-left">
          <div className="vu-label">VU</div>
          <div className="vu-meter">
            {bars.map((val, i) => (
              <div
                key={i}
                className={`vu-bar ${val > 0.8 ? 'vu-bar--red' : val > 0.6 ? 'vu-bar--yellow' : 'vu-bar--green'}`}
                style={{ height: `${val * 100}%` }}
              />
            ))}
          </div>
          <div className="vu-db-labels">
            <span>+3</span>
            <span>0</span>
            <span>-3</span>
            <span>-7</span>
            <span>-10</span>
          </div>
          <div className="volume-section">
            <span className="volume-label">VOL</span>
            <input
              type="range"
              className="volume-slider"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
            />
          </div>
        </div>

        {/* Center: Tape bay */}
        <div className="player-center">
          <AnimatePresence>
            {isInserted && currentCassette ? (
              <motion.div
                key="tape"
                className="tape-bay"
                initial={{ y: -80, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -80, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 200, damping: 22 }}
              >
                <div className="tape-body" style={{ borderColor: currentCassette.color }}>
                  <div className="tape-label" style={{ backgroundColor: currentCassette.color }}>
                    <span className="tape-genre-text">{currentCassette.genre}</span>
                  </div>
                  <div className="tape-reels-row">
                    <motion.div
                      className="tape-reel"
                      animate={{ rotate: isPlaying ? leftRotation : 0 }}
                      transition={{ duration: 0.5, ease: 'linear' }}
                    />
                    <div className="tape-window" />
                    <motion.div
                      className="tape-reel"
                      animate={{ rotate: isPlaying ? rightRotation : 0 }}
                      transition={{ duration: 0.5, ease: 'linear' }}
                    />
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                className="tape-bay tape-bay--empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <span className="tape-bay-hint">No tape inserted</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Progress bar */}
          <div className="progress-bar-container">
            <div className="progress-bar" style={{ width: `${progress * 100}%` }} />
          </div>

          {/* Quality selector */}
          <div className="quality-selector">
            <span className="quality-label">
              TAPE TYPE{isPlaying && !filterActive ? ' (visual only)' : ''}
            </span>
            <div className="quality-buttons">
              {qualityLabels.map((q) => (
                <button
                  key={q}
                  className={`quality-btn ${quality === q ? 'quality-btn--active' : ''}`}
                  onClick={() => setQuality(q)}
                >
                  {q.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right panel: Track display + speaker */}
        <div className="player-right">
          <div className="track-display">
            <div className="track-display-screen">
              {currentTrack ? (
                <>
                  <div className="track-now">
                    <span className="track-label">NOW</span>
                    <div className="track-name-scroll">
                      <span>{currentTrack.name}</span>
                    </div>
                    <div className="track-artist">{currentTrack.artistName}</div>
                    {currentFeatures ? (
                      <div className="track-features">
                        <span>{currentFeatures.bpm} BPM</span>
                        <span>NRG {currentFeatures.energy}</span>
                        <span>MOD {currentFeatures.mood}</span>
                      </div>
                    ) : (
                      <div className="track-features track-features--empty">NO DATA</div>
                    )}
                  </div>
                  <div className="track-divider" />
                  <div className="track-next">
                    <span className="track-label">NEXT</span>
                    {nextTrack ? (
                      <>
                        <div className="track-name-scroll track-name-scroll--dim">
                          <span>{nextTrack.name}</span>
                        </div>
                        <div className="track-artist track-artist--dim">{nextTrack.artistName}</div>
                      </>
                    ) : (
                      <div className="track-artist">—</div>
                    )}
                  </div>
                </>
              ) : (
                <div className="track-idle">INSERT TAPE</div>
              )}
            </div>
          </div>

          <div className="speaker-grille">
            {Array.from({ length: 8 }, (_, row) => (
              <div key={row} className="speaker-row">
                {Array.from({ length: 10 }, (_, col) => (
                  <div key={col} className="speaker-dot" />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="player-controls">
        <button
          className="ctrl-btn ctrl-btn--eject"
          onClick={handleEject}
          disabled={!isInserted}
          title="Eject"
        >
          &#9650;
        </button>
        <button
          className="ctrl-btn"
          disabled={!isInserted || !isPlaying}
          title="Fast backward (hold)"
          onMouseDown={startFB}
          onMouseUp={stopFB}
          onMouseLeave={stopFB}
          onTouchStart={startFB}
          onTouchEnd={stopFB}
        >
          &#9664;&#9664;
        </button>
        <button
          className="ctrl-btn ctrl-btn--play"
          onClick={handlePlay}
          disabled={!isInserted || isPlaying}
          title="Play"
        >
          &#9654;
        </button>
        <button
          className="ctrl-btn"
          onClick={handlePause}
          disabled={!isInserted || !isPlaying}
          title="Pause"
        >
          &#9646;&#9646;
        </button>
        <button
          className="ctrl-btn ctrl-btn--stop"
          onClick={handleStop}
          disabled={!isInserted || playbackState === 'stopped'}
          title="Stop"
        >
          &#9632;
        </button>
        <button
          className="ctrl-btn"
          disabled={!isInserted || !isPlaying}
          title="Fast forward (hold)"
          onMouseDown={startFF}
          onMouseUp={stopFF}
          onMouseLeave={stopFF}
          onTouchStart={startFF}
          onTouchEnd={stopFF}
        >
          &#9654;&#9654;
        </button>
        <button
          className="ctrl-btn"
          disabled={!isInserted || !nextTrack}
          title="Next track"
          onClick={() => {
            playQueueFrom(displayQueue, currentTrackIndex + 1).catch(() => {})
          }}
        >
          &#9654;&#124;
        </button>
      </div>
    </div>
  )
}
