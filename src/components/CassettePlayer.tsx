import { useEffect, useRef, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { usePlayerStore } from '../store/playerStore'
import type { TrackFeatures } from '../services/featureCache'
import { getMusicKitInstance, playQueueFrom } from '../services/appleMusic'
import { useVUMeter } from '../hooks/useVUMeter'
import { useAudioFilter } from '../hooks/useAudioFilter'
import { useRewindSFX } from '../hooks/useRewindSFX'
import { useButtonSFX } from '../hooks/useButtonSFX'
import { useMotorSFX } from '../hooks/useMotorSFX'
import { usePreviewAnalysis } from '../hooks/usePreviewAnalysis'
import type { AudioQuality } from '../types/music'
import * as A from '../assets/playerAssets'

// dB meter tick positions: y offset relative to db frame top (frame is at player y=45)
const DB_TICKS = [
  { label: '3',   y: 3   },
  { label: '2',   y: 26  },
  { label: '1',   y: 49  },
  { label: '0',   y: 72  },
  { label: '-1',  y: 95  },
  { label: '-2',  y: 118 },
  { label: '-3',  y: 141 },
  { label: '-5',  y: 174 },
  { label: '-7',  y: 207 },
  { label: '-10', y: 240 },
  { label: '-20', y: 286 },
]

// Volume track tick y offsets relative to vol track top (player y=45)
const VOL_TICK_Y = [0, 30, 62, 94, 126, 146, 178, 210, 242, 259]

function formatTime(sec: number) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

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
  useMotorSFX(isPlaying || playbackState === 'loading')
  useAudioFilter(quality, isPlaying)
  const rewindSFX = useRewindSFX()
  const { playReg, playEject } = useButtonSFX()

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
    try { music = getMusicKitInstance() } catch { return }

    const onStateChange = () => {
      const state = music.playbackState
      const states = MusicKit.PlaybackStates
      if (state === states.playing) { setPlaybackState('playing'); setPendingPlay(false) }
      else if (state === states.paused) { setPlaybackState('paused') }
      else if (state === states.stopped) { setPlaybackState('stopped') }
      else if (state === states.loading || state === states.waiting) { setPlaybackState('loading'); setPendingPlay(true) }
      else if (state === states.completed) {
        setPlaybackState('stopped')
        const q = queuedTracksRef.current.length > 0 ? queuedTracksRef.current : (currentCassetteRef.current?.tracks ?? [])
        const nextIdx = currentTrackIndexRef.current + 1
        if (nextIdx < q.length) playQueueFrom(q, nextIdx).catch(() => {})
      }
    }

    const onNowPlayingChange = () => {
      const nowId = music.nowPlayingItem?.id
      const q = queuedTracksRef.current.length > 0 ? queuedTracksRef.current : (currentCassetteRef.current?.tracks ?? [])
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
    if (!isPlaying) { if (tickRef.current) clearInterval(tickRef.current); return }
    tickRef.current = setInterval(() => {
      try {
        const music = getMusicKitInstance()
        setCurrentTime(music.currentPlaybackTime)
        setDuration(music.currentPlaybackDuration)
      } catch {/* ignore */}
    }, 500)
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [isPlaying, setCurrentTime, setDuration])

  // Sync volume
  useEffect(() => {
    try { getMusicKitInstance().volume = volume } catch {/* not yet configured */}
  }, [volume])

  async function handlePlay() {
    try {
      const music = getMusicKitInstance()
      if (playbackState === 'playing') { music.stop(); return }
      if (playbackState !== 'paused') {
        music.stop()
        setPendingPlay(true)
      }
      await music.play()
    } catch (e) { setPendingPlay(false); console.error(e) }
  }

  function handlePause() {
    try {
      const music = getMusicKitInstance()
      if (playbackState === 'paused') music.play()
      else music.pause()
    } catch {/* */}
  }
  function handleStop() { setPendingPlay(false); try { getMusicKitInstance().stop(); setCurrentTime(0) } catch {/* */} }

  const fbPressRef = useRef<{ startedAt: number; positionAt: number } | null>(null)
  function getAudioEl() { return document.querySelector('audio') as HTMLAudioElement | null }
  function startFF() { const el = getAudioEl(); if (el) el.playbackRate = 8 }
  function stopFF() { const el = getAudioEl(); if (el) el.playbackRate = 1 }
  function startFB() {
    const el = getAudioEl(); if (el) el.muted = true
    fbPressRef.current = { startedAt: Date.now(), positionAt: getMusicKitInstance().currentPlaybackTime }
    rewindSFX.play()
  }
  function stopFB() {
    if (!fbPressRef.current) return
    const heldSeconds = (Date.now() - fbPressRef.current.startedAt) / 1000
    const target = Math.max(0, fbPressRef.current.positionAt - heldSeconds * 8)
    fbPressRef.current = null
    rewindSFX.stop(() => {
      try { getMusicKitInstance().seekToTime(target) } catch {/* */}
      const el = getAudioEl(); if (el) el.muted = false
    })
  }
  async function handleEject() {
    setPendingPlay(false)
    fbPressRef.current = null; stopFF()
    try { getMusicKitInstance().stop() } catch {/* */}
    ejectCassette()
  }

  const featuresMap = usePlayerStore((s) => s.featuresMap)
  const displayQueue = queuedTracks.length > 0 ? queuedTracks : (currentCassette?.tracks ?? [])
  usePreviewAnalysis(displayQueue)
  const currentTrack = displayQueue[currentTrackIndex]
  const currentFeatures: TrackFeatures | undefined = currentTrack ? featuresMap.get(currentTrack.id) : undefined
  const nextTrack = displayQueue[currentTrackIndex + 1]

  // Snap sliders to current track's features on track change
  useEffect(() => {
    if (!currentTrack) return
    const f = featuresMap.get(currentTrack.id)
    if (!f) return
    setTempoFilter(Math.round(Math.min(100, Math.max(0, ((f.bpm - 60) / 120) * 100))))
    setEnergyFilter(f.energy)
    setMoodFilter(f.mood)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, setTempoFilter, setEnergyFilter, setMoodFilter])

  const progress = duration > 0 ? currentTime / duration : 0
  // Reel rotation: left reel unwinds (tape moving off), right reel winds up
  const leftDeg = progress * 360
  const rightDeg = (1 - progress) * 360

  // VU meter: average bar value → dB gauge position
  // dB frame: y=45, h=303. Gauge is 4px tall. At silence: bottom of frame. At peak: top.
  const avgVU = useMemo(() => bars.reduce((a, b) => a + b, 0) / (bars.length || 1), [bars])
  const scaledVU = Math.min(1, Math.pow(avgVU * 4, 0.5)) * volume
  const gaugeY = (1 - scaledVU) * 230

  // Volume knob: track y=53, h=303, knob h=44. Top=max vol, bottom=min vol.
  const volKnobY = 53 + (1 - volume) * 280

  // Tape type knob snap positions
  const snapPositions: Record<AudioQuality, number> = { lo: 692, mid: 730, hi: 772 }
  const qualityLabels: AudioQuality[] = ['lo', 'mid', 'hi']

  const [pressedBtn, setPressedBtn] = useState<string | null>(null)
  const [pendingPlay, setPendingPlay] = useState(false)
  const [knobDragX, setKnobDragX] = useState<number | null>(null)
  const knobDragRef = useRef<{ startX: number; startKnobX: number } | null>(null)

  function onKnobMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    knobDragRef.current = { startX: e.clientX, startKnobX: snapPositions[quality] }
    const onMove = (ev: MouseEvent) => {
      if (!knobDragRef.current) return
      const delta = ev.clientX - knobDragRef.current.startX
      setKnobDragX(Math.min(772, Math.max(692, knobDragRef.current.startKnobX + delta)))
    }
    const onUp = (ev: MouseEvent) => {
      if (!knobDragRef.current) return
      const rawX = knobDragRef.current.startKnobX + (ev.clientX - knobDragRef.current.startX)
      const snapped = ([692, 730, 772] as const).reduce((a, b) =>
        Math.abs(b - rawX) < Math.abs(a - rawX) ? b : a
      )
      const qualityMap: Record<number, AudioQuality> = { 692: 'lo', 730: 'mid', 772: 'hi' }
      setQuality(qualityMap[snapped])
      setKnobDragX(null)
      knobDragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const tapeKnobX = knobDragX ?? snapPositions[quality]

  return (
    <div className="np-player">

      {/* ── Outer body shadow ────────────────────────────── */}
      <img src={A.imgVector9} alt="" className="np-body-shadow" />

      {/* ── Background body panels (rotate-180 as in Figma) ─ */}
      <img src={A.imgBackPanel} alt="" className="np-back-panel np-back-panel--1" />
      <img src={A.imgBackPanel1} alt="" className="np-back-panel np-back-panel--2" />

      {/* Horizontal divider lines */}
      <img src={A.imgLines} alt="" className="np-divider np-divider--top" />
      <img src={A.imgLines} alt="" className="np-divider np-divider--bottom" />

      {/* Three cream panels */}
      <div className="np-panel np-panel--left" />
      <div className="np-panel np-panel--center" />
      <div className="np-panel np-panel--right" />

      {/* Center divider line */}
      <img src={A.imgLines1} alt="" className="np-divider-center" />

      {/* Button area drop shadow */}
      <div className="np-btn-shadow" />

      {/* Button guard elevations (left/right of button area) */}
      <img src={A.imgButtonsGuardElevLeft} alt="" className="np-btn-guard-elev np-btn-guard-elev--right" />
      <img src={A.imgButtonsGuardElevLeft1} alt="" className="np-btn-guard-elev np-btn-guard-elev--left" />

      {/* ── LOGO (bottom-left) ──────────────────────────── */}
      <div className="np-logo">
        <div className="np-logo-stripe np-logo-stripe--red">
          <img src={A.imgGroup10} alt="" className="np-logo-icon" />
        </div>
        <div className="np-logo-stripe np-logo-stripe--tan">
          <span className="np-logo-text">KASSETTE</span>
        </div>
        <div className="np-logo-stripe np-logo-stripe--teal" />
      </div>

      {/* ── LEFT PANEL: dB Meter + Volume ───────────────── */}
      {/* dB meter */}
      <span className="np-label np-db-label">dB</span>
      <div className="np-db-frame">
        <img src={A.imgLine1} alt="" className="np-db-axis" />
        {/* Tick marks and labels at fixed y offsets within the frame */}
        {DB_TICKS.map(({ label, y }) => (
          <span key={label} className="np-db-num" style={{ top: `${y}px` }}>{label}</span>
        ))}
        {DB_TICKS.map(({ label, y }) => (
          <img key={`t-${label}`} src={A.imgLine2} alt="" className="np-db-tick" style={{ top: `${y}px` }} />
        ))}
        {/* Animated gauge needle */}
        <div className="np-db-gauge" style={{ top: `${gaugeY}px` }} />
        {/* Glass overlay */}
        <div className="np-db-glass" />
      </div>

      {/* Volume slider */}
      <span className="np-label np-vol-label">VOL</span>
      <div className="np-vol-track">
        <img src={A.imgVolTrackBg} alt="" className="np-vol-track-bg" />
        <div className="np-vol-track-groove" />
        <img src={A.imgVolumeTicks} alt="" className="np-vol-ticks-img" />
      </div>
      {/* Full-track invisible range input */}
      <input
        type="range" min={0} max={1} step={0.01} value={volume}
        className="np-vol-input"
        onChange={(e) => setVolume(Number(e.target.value))}
      />
      {/* Knob image follows value */}
      <div className="np-vol-knob-wrap" style={{ top: `${volKnobY}px` }}>
        <img src={A.imgVolumeSliderNob} alt="" className="np-vol-knob-img" />
      </div>

      {/* ── CENTER: Tape Bay ─────────────────────────────── */}
      <div className="np-tape-bay">
        <div className="np-tape-bay-inner" style={{
          background: 'linear-gradient(150.65deg, rgb(49,40,40) 20%, rgb(9,5,5) 75%)',
          boxShadow: 'inset 0px 8px 1px 0px black',
        }} />

        <img src={A.imgBackTape} alt="" className="np-back-tape" />

        {/* In-bay cassette — flies in from carousel via layoutId */}
        <AnimatePresence>
          {isInserted && currentCassette && (
            <motion.div
              key={currentCassette.id}
              layoutId={`cassette-${currentCassette.id}`}
              className="np-cassette-in-bay"
            >
              <div className="cassette-body" style={{ borderColor: currentCassette.color }}>
                <div className="cassette-label" style={{ backgroundColor: currentCassette.color }}>
                  <span className="cassette-genre">{currentCassette.genre}</span>
                  <span className="cassette-count">{currentCassette.tracks.length} tracks</span>
                </div>
                <div className="cassette-reels">
                  <div className="cassette-reel" />
                  <div className="cassette-tape-window" />
                  <div className="cassette-reel" />
                </div>
                <div className="cassette-bottom-strip" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Left reel */}
        <motion.div
          className="np-reel np-reel--left"
          animate={{ rotate: isPlaying ? leftDeg : 0 }}
          transition={{ duration: 0.5, ease: 'linear' }}
        >
          <img src={A.imgReelOuter} alt="" className="np-reel-outer" />
          <img src={A.imgReelHub} alt="" className="np-reel-hub" />
          <img src={A.imgReelSpokes} alt="" className="np-reel-spokes" />
          <img src={A.imgReelCenter1} alt="" className="np-reel-c1" />
          <img src={A.imgReelCenter2} alt="" className="np-reel-c2" />
          <img src={A.imgReelCenter3} alt="" className="np-reel-c3" />
        </motion.div>
        {/* Right reel */}
        <motion.div
          className="np-reel np-reel--right"
          animate={{ rotate: isPlaying ? rightDeg : 0 }}
          transition={{ duration: 0.5, ease: 'linear' }}
        >
          <img src={A.imgReelOuter} alt="" className="np-reel-outer" />
          <img src={A.imgReelHub} alt="" className="np-reel-hub" />
          <img src={A.imgReelSpokes} alt="" className="np-reel-spokes" />
          <img src={A.imgReelCenter1} alt="" className="np-reel-c1" />
          <img src={A.imgReelCenter2} alt="" className="np-reel-c2" />
          <img src={A.imgReelCenter3} alt="" className="np-reel-c3" />
        </motion.div>
        {(!isInserted || !currentCassette) && (
          <div className="np-tape-empty">INSERT TAPE</div>
        )}
      </div>

      {/* ── Screen ───────────────────────────────────────── */}
      <div className="np-screen">
        {/* Content */}
        <div className="np-screen-inner">
          {/* NEXT column */}
          <div className="np-screen-col np-screen-col--next">
            <div className="np-screen-header">
              <span className="np-screen-label">NEXT</span>
            </div>
            {nextTrack ? (
              <>
                <div className="np-screen-progress-track np-screen-progress-track--empty" />
                <div className="np-screen-title np-screen-title--dim">{nextTrack.name}</div>
                <div className="np-screen-artist np-screen-artist--dim">{nextTrack.artistName}</div>
              </>
            ) : (
              <div className="np-screen-artist np-screen-artist--dim">—</div>
            )}
            {(() => {
              const nextFeatures = nextTrack ? featuresMap.get(nextTrack.id) : undefined
              return nextFeatures ? (
                <div className="np-screen-meta np-screen-meta--dim">
                  <span>{nextFeatures.bpm} BPM</span>
                  <img src={A.imgLine14} alt="" className="np-meta-sep" />
                  <span>NRG {nextFeatures.energy}</span>
                  <img src={A.imgLine14} alt="" className="np-meta-sep" />
                  <span>MOOD {nextFeatures.mood}</span>
                </div>
              ) : (
                <div className="np-screen-meta np-screen-meta--placeholder" />
              )
            })()}
          </div>

          <div className="np-screen-divider" />

          {/* NOW column */}
          <div className="np-screen-col np-screen-col--now">
            <div className="np-screen-header">
              <span className="np-screen-label">NOW</span>
              {currentTrack && (
                <span className="np-screen-time">{formatTime(currentTime)} / {formatTime(duration)}</span>
              )}
            </div>
            {currentTrack ? (
              <>
                <div className="np-screen-progress-track">
                  <div className="np-screen-progress-fill" style={{ width: `${progress * 100}%` }} />
                </div>
                <div className="np-screen-title">{currentTrack.name}</div>
                <div className="np-screen-artist">{currentTrack.artistName}</div>
              </>
            ) : (
              <div className="np-screen-idle">INSERT TAPE</div>
            )}
            {currentFeatures ? (
              <div className="np-screen-meta">
                <span>{currentFeatures.bpm} BPM</span>
                <img src={A.imgLine14} alt="" className="np-meta-sep" />
                <span>NRG {currentFeatures.energy}</span>
                <img src={A.imgLine14} alt="" className="np-meta-sep" />
                <span>MOOD {currentFeatures.mood}</span>
              </div>
            ) : (
              <div className="np-screen-meta np-screen-meta--empty">NO DATA</div>
            )}
          </div>
        </div>
        {/* Glass reflection */}
        <div className="np-screen-glass" />
      </div>

      {/* ── Button Guard Text Labels ─────────────────────── */}
      <div className="np-btn-labels">
        <span style={{ left: '222px' }}>REWIND</span>
        <span style={{ left: '295px' }}>STOP</span>
        <span style={{ left: '356px' }}>PAUSE</span>
        <span style={{ left: '425px' }}>PLAY</span>
        <span style={{ left: '494px' }}>F.F</span>
        <span style={{ left: '559px' }}>EJECT</span>
      </div>

      {/* Button guard overlay */}
      <img src={A.imgButtonGuard} alt="" className="np-btn-guard" />

      {/* ── Buttons ──────────────────────────────────────── */}
      {/* Order: REWIND | STOP | PAUSE | PLAY | F.F | EJECT            */}
      {/* Figma names are swapped: imgNextButton=REWIND, imgPrevButton=FF */}
      <div className="np-buttons">
        {/* REWIND (hold) */}
        <button
          className="np-btn"
          disabled={!isInserted || !isPlaying}
          onMouseDown={(e) => { playReg(); setPressedBtn('rewind'); startFB(e) }}
          onMouseUp={(e) => { setPressedBtn(null); stopFB(e) }}
          onMouseLeave={(e) => { setPressedBtn(null); stopFB(e) }}
          onTouchStart={(e) => { setPressedBtn('rewind'); startFB(e) }}
          onTouchEnd={(e) => { setPressedBtn(null); stopFB(e) }}
        >
          <div className={`np-btn-slot np-btn-slot--sm${pressedBtn === 'rewind' ? ' np-btn-slot--pressed' : ''}`}>
            <div className="np-btn-offset"><img src={A.imgButtonOffset} alt="" /></div>
            <div className="np-btn-inner">
              <img src={A.imgNextButton} alt="Rewind" className="np-btn-img" />
              <div className="np-btn-gradient"><img src={A.imgButtonGradiant} alt="" /></div>
            </div>
          </div>
        </button>
        {/* STOP */}
        <button className="np-btn" onClick={handleStop} disabled={!isInserted || playbackState === 'stopped'}
          onMouseDown={() => { playReg(); setPressedBtn('stop') }} onMouseUp={() => setPressedBtn(null)} onMouseLeave={() => setPressedBtn(null)}>
          <div className={`np-btn-slot np-btn-slot--sm${pressedBtn === 'stop' ? ' np-btn-slot--pressed' : ''}`}>
            <div className="np-btn-offset"><img src={A.imgButtonOffset} alt="" /></div>
            <div className="np-btn-inner">
              <img src={A.imgStopButton} alt="Stop" className="np-btn-img" />
              <div className="np-btn-gradient"><img src={A.imgButtonGradiant} alt="" /></div>
            </div>
          </div>
        </button>
        {/* PAUSE */}
        <button className="np-btn" onClick={handlePause} disabled={!isInserted || (playbackState !== 'playing' && playbackState !== 'paused')}
          onMouseDown={() => { playReg(); setPressedBtn('pause') }} onMouseUp={() => { if (playbackState === 'paused') setPressedBtn(null) }} onMouseLeave={() => setPressedBtn(null)}>
          <div className={`np-btn-slot np-btn-slot--sm${(pressedBtn === 'pause' || playbackState === 'paused') ? ' np-btn-slot--pressed' : ''}`}>
            <div className="np-btn-offset"><img src={A.imgButtonOffset} alt="" /></div>
            <div className="np-btn-inner">
              <img src={A.imgPauseButton} alt="Pause" className="np-btn-img" />
              <div className="np-btn-gradient"><img src={A.imgButtonGradiant} alt="" /></div>
            </div>
          </div>
        </button>
        {/* PLAY */}
        <button className="np-btn" onClick={handlePlay} disabled={!isInserted}
          onMouseDown={() => { playReg(); setPressedBtn('play') }}
          onMouseUp={() => { if (playbackState === 'playing') setPressedBtn(null) }}
          onMouseLeave={() => setPressedBtn(null)}>
          <div className={`np-btn-slot np-btn-slot--sm${(pressedBtn === 'play' || pendingPlay || playbackState === 'playing' || playbackState === 'paused') ? ' np-btn-slot--pressed' : ''}`}>
            <div className="np-btn-offset"><img src={A.imgButtonOffset} alt="" /></div>
            <div className="np-btn-inner">
              <img src={A.imgPlayButton} alt="Play" className="np-btn-img" />
              <div className="np-btn-gradient"><img src={A.imgButtonGradiant} alt="" /></div>
            </div>
          </div>
        </button>
        {/* F.F (hold) */}
        <button
          className="np-btn"
          disabled={!isInserted || !isPlaying}
          onMouseDown={(e) => { playReg(); setPressedBtn('ff'); startFF(e) }}
          onMouseUp={(e) => { setPressedBtn(null); stopFF(e) }}
          onMouseLeave={(e) => { setPressedBtn(null); stopFF(e) }}
          onTouchStart={(e) => { setPressedBtn('ff'); startFF(e) }}
          onTouchEnd={(e) => { setPressedBtn(null); stopFF(e) }}
        >
          <div className={`np-btn-slot np-btn-slot--sm${pressedBtn === 'ff' ? ' np-btn-slot--pressed' : ''}`}>
            <div className="np-btn-offset"><img src={A.imgButtonOffset} alt="" /></div>
            <div className="np-btn-inner">
              <img src={A.imgPrevButton} alt="Fast Forward" className="np-btn-img" />
              <div className="np-btn-gradient"><img src={A.imgButtonGradiant} alt="" /></div>
            </div>
          </div>
        </button>
        {/* EJECT */}
        <button className="np-btn" onClick={handleEject} disabled={!isInserted}
          onMouseDown={() => { playEject(); setPressedBtn('eject') }} onMouseUp={() => setPressedBtn(null)} onMouseLeave={() => setPressedBtn(null)}>
          <div className={`np-btn-slot np-btn-slot--lg${pressedBtn === 'eject' ? ' np-btn-slot--pressed' : ''}`}>
            <div className="np-btn-offset"><img src={A.imgButtonOffset} alt="" /></div>
            <div className="np-btn-inner">
              <img src={A.imgEjectButton} alt="Eject" className="np-btn-img" />
              <div className="np-btn-gradient"><img src={A.imgButtonGradiant} alt="" /></div>
            </div>
          </div>
        </button>
      </div>

      {/* ── RIGHT PANEL: Speaker + Tape Type ─────────────── */}
      <img src={A.imgSpeaker} alt="" className="np-speaker" />

      {/* Tape type selector */}
      <span className="np-label np-tapetype-label">TAPE TYPE</span>
      <div className="np-tapetype-frame">
        <img src={A.imgTapeTypeBg} alt="" className="np-tapetype-bg" />
        <div className="np-tapetype-inner" style={{
          background: 'linear-gradient(161deg, rgb(49,40,40) 20%, rgb(9,5,5) 75%)',
          boxShadow: 'inset 0px 8px 1px 0px black',
        }} />
      </div>
      <div className="np-tapetype-options">
        {qualityLabels.map((q) => (
          <button key={q} className={`np-tapetype-opt ${quality === q ? 'np-tapetype-opt--active' : ''}`} onClick={() => setQuality(q)}>
            {q.toUpperCase()}
          </button>
        ))}
      </div>
      <div
        className="np-tapetype-knob-wrap"
        style={{ left: `${tapeKnobX}px`, cursor: 'grab' }}
        onMouseDown={onKnobMouseDown}
      >
        <img src={A.imgTapeTypeNobSelector} alt="" className="np-tapetype-knob-img" />
      </div>
    </div>
  )
}
