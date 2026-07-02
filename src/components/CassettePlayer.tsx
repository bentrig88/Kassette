import { useEffect, useLayoutEffect, useRef, useMemo, useState } from 'react'
import { motion, useMotionValue, useTransform, animate } from 'framer-motion'
import { usePlayerStore } from '../store/playerStore'
import { getMusicKitInstance, playQueueFrom } from '../services/appleMusic'
import { buildNormalizer } from '../services/featureNormalize'
import { useVUMeter } from '../hooks/useVUMeter'
import { useAudioFilter } from '../hooks/useAudioFilter'
import { useRewindSFX } from '../hooks/useRewindSFX'
import { useButtonSFX } from '../hooks/useButtonSFX'
import { useDoorSFX } from '../hooks/useDoorSFX'
import { useMotorSFX } from '../hooks/useMotorSFX'
import { usePreviewAnalysis } from '../hooks/usePreviewAnalysis'
import type { AudioQuality } from '../types/music'
import * as A from '../assets/player/playerAssets'
import logoUrl from '../assets/misc/logo.svg'
import { CassetteTapeBody } from './CassetteTapeBody'
import { TrackDisplay } from './TrackDisplay'

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

export function CassettePlayer() {
  const currentCassette      = usePlayerStore((s) => s.currentCassette)
  const queuedTracks         = usePlayerStore((s) => s.queuedTracks)
  const isInserted           = usePlayerStore((s) => s.isInserted)
  const playbackState        = usePlayerStore((s) => s.playbackState)
  const queueDirty           = usePlayerStore((s) => s.queueDirty)
  const volume               = usePlayerStore((s) => s.volume)
  const quality              = usePlayerStore((s) => s.quality)
  const currentTrackIndex    = usePlayerStore((s) => s.currentTrackIndex)
  const currentTime          = usePlayerStore((s) => s.currentTime)
  const duration             = usePlayerStore((s) => s.duration)
  const ejectCassette        = usePlayerStore((s) => s.ejectCassette)
  const setPlaybackState     = usePlayerStore((s) => s.setPlaybackState)
  const setVolume            = usePlayerStore((s) => s.setVolume)
  const setQuality           = usePlayerStore((s) => s.setQuality)
  const setCurrentTrackIndex = usePlayerStore((s) => s.setCurrentTrackIndex)
  const setCurrentTime       = usePlayerStore((s) => s.setCurrentTime)
  const setDuration          = usePlayerStore((s) => s.setDuration)

  const isPlaying = playbackState === 'playing'

  const bars = useVUMeter(isPlaying)
  useMotorSFX(isPlaying || playbackState === 'loading')
  useAudioFilter(quality, isPlaying)
  const rewindSFX = useRewindSFX()
  const { playReg, playEject } = useButtonSFX()
  const { playDoorOpen, playTapeInsert } = useDoorSFX()

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

      // Boundary re-sync: the queue was re-sorted mid-playback, so MusicKit
      // just auto-advanced along its STALE window. If it started a different
      // track than our sorted queue intends, re-issue the window from the
      // fresh queue (the stale track plays only for a beat — the least
      // disruptive point to correct, vs. interrupting mid-track).
      // playQueueFrom clears the flag, so manual next/prev/play (which already
      // re-issue the window) never trip this path.
      const store = usePlayerStore.getState()
      if (store.queueDirty) {
        store.setQueueDirty(false)
        const intendedIdx = currentTrackIndexRef.current + 1
        const intended = q[intendedIdx]
        if (intended && nowId && intended.id !== nowId) {
          setCurrentTrackIndex(intendedIdx)
          setCurrentTime(0)
          playQueueFrom(q, intendedIdx).catch(() => {})
          return
        }
      }

      const idx = nowId ? q.findIndex((t) => t.id === nowId) : -1
      // Not found (e.g. the playing track was filtered out of a rebuilt queue
      // mid-play): keep the previous index rather than jumping the LCD to 0.
      if (idx >= 0) setCurrentTrackIndex(idx)
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
      if (playbackState === 'paused') { await music.play(); return }
      // Fresh start from stopped: sync MusicKit to our (possibly subgenre-filtered)
      // queue and play from the current track. playQueueFrom does setQueue+play
      // (no stop() — which would confuse MusicKit and silently fail).
      setPendingPlay(true)
      const q = queuedTracksRef.current.length > 0
        ? queuedTracksRef.current
        : (currentCassetteRef.current?.tracks ?? [])
      const started = await playQueueFrom(q, currentTrackIndexRef.current)
      // Nothing to play (empty/stale window) — don't leave the button latched.
      if (!started) setPendingPlay(false)
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

  function handleNextTrack() {
    const q = queuedTracksRef.current.length > 0 ? queuedTracksRef.current : (currentCassetteRef.current?.tracks ?? [])
    const nextIdx = currentTrackIndexRef.current + 1
    if (nextIdx < q.length) playQueueFrom(q, nextIdx).catch(() => {})
  }

  function handlePrevTrack() {
    const q = queuedTracksRef.current.length > 0 ? queuedTracksRef.current : (currentCassetteRef.current?.tracks ?? [])
    const prevIdx = currentTrackIndexRef.current - 1
    if (prevIdx >= 0) playQueueFrom(q, prevIdx).catch(() => {})
    else { try { getMusicKitInstance().seekToTime(0) } catch {/* */} }
  }

  // Media Session API — maps Mac keyboard play/pause (and next/prev) to transport controls
  useEffect(() => {
    if (!('mediaSession' in navigator) || !isInserted) return
    navigator.mediaSession.setActionHandler('play', () => { playReg(); handlePause() })
    navigator.mediaSession.setActionHandler('pause', () => { playReg(); handlePause() })
    navigator.mediaSession.setActionHandler('stop', () => { playReg(); handleStop() })
    navigator.mediaSession.setActionHandler('nexttrack', () => { playReg(); handleNextTrack() })
    navigator.mediaSession.setActionHandler('previoustrack', () => { playReg(); handlePrevTrack() })
    return () => {
      navigator.mediaSession.setActionHandler('play', null)
      navigator.mediaSession.setActionHandler('pause', null)
      navigator.mediaSession.setActionHandler('stop', null)
      navigator.mediaSession.setActionHandler('nexttrack', null)
      navigator.mediaSession.setActionHandler('previoustrack', null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInserted, playbackState])

  const fbPressRef = useRef<{ startedAt: number; positionAt: number } | null>(null)
  const fbRafRef = useRef<number | null>(null)
  function getAudioEl() { return document.querySelector('audio') as HTMLAudioElement | null }
  function startFF() { setReelModifier(1); const el = getAudioEl(); if (el) el.playbackRate = 8 }
  function stopFF() { setReelModifier(0); const el = getAudioEl(); if (el) el.playbackRate = 1 }
  function startFB() {
    setReelModifier(-1)
    const el = getAudioEl(); if (el) el.muted = true
    fbPressRef.current = { startedAt: Date.now(), positionAt: getMusicKitInstance().currentPlaybackTime }
    rewindSFX.play()
    // Drive the progress bar backward in real time
    function tick() {
      if (!fbPressRef.current) return
      const heldSeconds = (Date.now() - fbPressRef.current.startedAt) / 1000
      const simulated = Math.max(0, fbPressRef.current.positionAt - heldSeconds * 8)
      setCurrentTime(simulated)
      fbRafRef.current = requestAnimationFrame(tick)
    }
    fbRafRef.current = requestAnimationFrame(tick)
  }
  function stopFB() {
    if (fbRafRef.current !== null) { cancelAnimationFrame(fbRafRef.current); fbRafRef.current = null }
    if (!fbPressRef.current) return
    const heldSeconds = (Date.now() - fbPressRef.current.startedAt) / 1000
    const target = Math.max(0, fbPressRef.current.positionAt - heldSeconds * 8)
    fbPressRef.current = null
    setReelModifier(0)
    rewindSFX.stop(() => {
      try { getMusicKitInstance().seekToTime(target) } catch {/* */}
      const el = getAudioEl(); if (el) el.muted = false
    })
  }
  async function handleEject() {
    setPendingPlay(false)
    // Hard-cancel any in-flight rewind WITHOUT the usual seek: kill the rAF,
    // silence the SFX loop, and unmute — otherwise the unmute (which lives in
    // stopFB's guarded SFX callback) never runs and audio stays muted.
    if (fbRafRef.current !== null) { cancelAnimationFrame(fbRafRef.current); fbRafRef.current = null }
    fbPressRef.current = null
    rewindSFX.cancel()
    const el = getAudioEl(); if (el) el.muted = false
    stopFF()
    try { getMusicKitInstance().stop() } catch {/* */}
    ejectCassette()
  }

  const insertSourceRect = usePlayerStore((s) => s.insertSourceRect)
  const bayRef = useRef<HTMLDivElement>(null)
  const bayX = useMotionValue(0)
  const bayY = useMotionValue(0)
  const bayScale = useMotionValue(1)
  const bayRotateX = useMotionValue(0)

  // FLIP: when the bay cassette mounts, set x/y/scale to the carousel position then
  // animate to 0/0/1. Using Framer Motion motion values avoids the GPU compositing
  // conflict that occurs when a CSS transition is active on a parent that also
  // has children with CSS animations (the ct-reel spin animation).
  useLayoutEffect(() => {
    if (!bayRef.current || !insertSourceRect || !isInserted) return
    const el = bayRef.current
    // Reset motion values so getBoundingClientRect reflects natural position
    bayX.set(0)
    bayY.set(0)
    bayScale.set(1)
    const targetRect = el.getBoundingClientRect()
    const sourceCX = insertSourceRect.left + insertSourceRect.width / 2
    const sourceCY = insertSourceRect.top + insertSourceRect.height / 2
    const targetCX = targetRect.left + targetRect.width / 2
    const targetCY = targetRect.top + targetRect.height / 2
    bayX.set(sourceCX - targetCX)
    bayY.set(sourceCY - targetCY - 5)
    bayScale.set(1.12)
    bayRotateX.set(15)
    animate(bayX, 0, { duration: 0.3, ease: [0, 0, 0.58, 1] })
    animate(bayY, 0, { duration: 0.3, ease: [0, 0, 0.58, 1] })
    animate(bayScale, 1, { duration: 0.3, ease: [0, 0, 0.58, 1] })
    animate(bayRotateX, 0, { duration: 0.3, ease: [0, 0, 0.58, 1] })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCassette?.id, isInserted])

  const displayQueue = queuedTracks.length > 0 ? queuedTracks : (currentCassette?.tracks ?? [])
  usePreviewAnalysis(displayQueue)
  const currentTrack = displayQueue[currentTrackIndex]
  let nextTrack = displayQueue[currentTrackIndex + 1]
  // While MusicKit drives playback its internal 20-track window may hold a
  // pre-re-sort order — show ITS actual next item so the NEXT line never lies.
  // Exception: queueDirty means a mid-play re-sort is pending and the next
  // track boundary will re-issue the window from OUR queue, so the sorted
  // queue's next (the fallback above) is what will actually play. With no
  // internal next (window end) the fallback is likewise what plays next.
  if (playbackState !== 'stopped' && !queueDirty) {
    try {
      const mq = getMusicKitInstance().queue
      const item = mq.items[mq.position + 1]
      if (item) {
        nextTrack = displayQueue.find((t) => t.id === item.id) ?? {
          id: item.id,
          name: item.attributes.name,
          artistName: item.attributes.artistName,
          albumName: item.attributes.albumName,
          durationInMillis: item.attributes.durationInMillis,
          genreNames: item.attributes.genreNames ?? [],
        }
      }
    } catch {/* MusicKit not configured yet */}
  }

  // Snap sliders to current track's features (library-relative) on track change.
  // Suppressed while stopped: a stopped-state "now" change comes from the user
  // re-filtering (sliders/subgenres rebuild the queue in PlaylistController) —
  // snapping would overwrite the very slider values they just set.
  // snapFilters clears the touched flags: a snapped position is information
  // about the playing track, not a user-set target.
  useEffect(() => {
    if (!currentTrack) return
    const store = usePlayerStore.getState()
    if (store.playbackState === 'stopped') return
    const f = store.featuresMap.get(currentTrack.id)
    if (!f) return
    const n = buildNormalizer(store.featuresMap).normalize(f)
    store.snapFilters(n.pace, n.energy, n.mood)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id])

  const progress = duration > 0 ? currentTime / duration : 0

  // VU meter: average bar value → dB gauge position
  // dB frame: y=45, h=303. Gauge is 4px tall. At silence: bottom of frame. At peak: top.
  const avgVU = useMemo(() => bars.reduce((a, b) => a + b, 0) / (bars.length || 1), [bars])
  const scaledVU = Math.min(1, Math.pow(avgVU * 4, 0.5)) * volume
  const gaugeY = isPlaying ? (1 - scaledVU) * 230 : 286

  // Volume knob: track y=53, h=303, knob h=44. Top=max vol, bottom=min vol.
  const volKnobY = 53 + (1 - volume) * 280

  // Tape type knob snap positions
  const snapPositions: Record<AudioQuality, number> = { lo: 692, mid: 730, hi: 772 }
  const qualityLabels: AudioQuality[] = ['lo', 'mid', 'hi']

  const [pressedBtn, setPressedBtn] = useState<string | null>(null)
  const [pendingPlay, setPendingPlay] = useState(false)
  const [knobDragX, setKnobDragX] = useState<number | null>(null)
  // -1 = rewind held, 0 = normal, 1 = FF held
  const [reelModifier, setReelModifier] = useState<-1 | 0 | 1>(0)

  const baseActive = isPlaying || pendingPlay || playbackState === 'loading'
  const reelSpeed = baseActive ? (reelModifier === 1 ? 3 : reelModifier === -1 ? -3 : 1) : 0

  // Shared rotation for both np-reels — same direction, same speed, perfectly in sync.
  // Imperative loop: stops instantly at the current angle (no snap-back).
  const reelRotate = useMotionValue(0)

  // Protection door: open when no tape, closes once tape is seated
  const doorAngle = useMotionValue(-45) // starts open
  const doorShadowOpacity = useTransform(doorAngle, [-45, 0], [1, 0])
  const doorShadowScaleY = useTransform(doorAngle, [-45, 0], [1, 1.6])
  const doorShadowSkewX = useTransform(doorAngle, [-45, 0], [20, -5])
  const doorScaleY = useTransform(doorAngle, [-45, 0], [0.65, 1])
  const doorOverlayOpacity = useTransform(doorAngle, [-45, 0], [0.45, 0])
  const hingesBrightness = useTransform(doorAngle, [-45, 0], ['brightness(0.5)', 'brightness(1)'])
  const doorEdgeX = useTransform(doorAngle, [-45, 0], [0, 68])
  const doorEdgeY = useTransform(doorAngle, [-45, 0], [0, -111])
  const doorEdgeWidth = useTransform(doorAngle, [-45, 0], ['133%', '100%'])
  const doorEdgeOpacity = useTransform(doorAngle, [-45, 0], [1, 0])
  useEffect(() => {
    if (!isInserted || !currentCassette) {
      // Eject or no tape: open the door
      playDoorOpen()
      animate(doorAngle, -45, { duration: 0.35, ease: [0, 0, 0.58, 1] })
      return
    }
    // Close as soon as FLIP ends (0.3s) and play insert+close SFX
    const t = setTimeout(() => {
      playTapeInsert()
      animate(doorAngle, 0, { duration: 0.35, ease: [0, 0, 0.3, 1] })
    }, 300)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCassette?.id, isInserted])

  useEffect(() => {
    if (reelSpeed === 0) return
    const direction = reelSpeed > 0 ? 1 : -1
    const duration = 4 / Math.abs(reelSpeed)
    let controls: ReturnType<typeof animate> | null = null
    function tick() {
      controls = animate(reelRotate, reelRotate.get() + 360 * direction, {
        duration,
        ease: 'linear',
        onComplete: tick,
      })
    }
    tick()
    return () => { controls?.stop() }
  }, [reelSpeed, reelRotate])
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
      <img src={logoUrl} alt="Kassette" className="np-logo" />

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

        {/* In-bay cassette — FLIP animates from carousel position via Framer Motion values */}
        {isInserted && currentCassette && (
          <motion.div ref={bayRef} className="np-cassette-in-bay" style={{ x: bayX, y: bayY, scale: bayScale, rotateX: bayRotateX, transformPerspective: 800 }}>
            <div className="cassette-body cassette-body--new">
              <CassetteTapeBody cassette={currentCassette} reelSpeed={reelSpeed} />
            </div>
          </motion.div>
        )}

        {/* Left reel */}
        <motion.div className="np-reel np-reel--left" style={{ rotate: reelRotate }}>
          <div className="np-reel-frame">
            <img src={A.imgReelLeft} alt="" className="np-reel-img" />
          </div>
        </motion.div>
        {/* Right reel */}
        <motion.div className="np-reel np-reel--right" style={{ rotate: reelRotate }}>
          <div className="np-reel-frame">
            <img src={A.imgReelRight} alt="" className="np-reel-img" />
          </div>
        </motion.div>

        {/* Door shadow — cast on the panel below the bay when door is open */}
        <motion.div
          className="np-bay-door-shadow"
          style={{ opacity: doorShadowOpacity, scaleY: doorShadowScaleY, skewX: doorShadowSkewX }}
        />

        {/* Protection door — 3D flap hinged at bottom edge */}
        <div className="np-bay-door-wrap">
          {/* Door thickness edge — thin strip visible at top when door is open */}
          <motion.div
            className="np-bay-door-edge"
            style={{ x: doorEdgeX, y: doorEdgeY, width: doorEdgeWidth, opacity: doorEdgeOpacity }}
          />
          <motion.div className="np-bay-door" style={{ rotateX: doorAngle, scaleY: doorScaleY }}>
            <img src={A.imgDoor} alt="" className="np-bay-door-img" />
            <motion.div className="np-bay-door-overlay" style={{ opacity: doorOverlayOpacity }} />
          </motion.div>
        </div>

        {/* Hinges — darken in sync with door open angle */}
        <motion.img src={A.imgDoorHinges} alt="" className="np-bay-hinges" style={{ filter: hingesBrightness }} />

      </div>

      {/* ── Screen ───────────────────────────────────────── */}
      <TrackDisplay
        currentTrack={currentTrack}
        nextTrack={nextTrack}
        currentTime={currentTime}
        duration={duration}
        progress={progress}
      />

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
          onMouseDown={() => { playReg(); setPressedBtn('rewind'); startFB() }}
          onMouseUp={() => { setPressedBtn(null); stopFB() }}
          onMouseLeave={() => { setPressedBtn(null); stopFB() }}
          onTouchStart={() => { setPressedBtn('rewind'); startFB() }}
          onTouchEnd={() => { setPressedBtn(null); stopFB() }}
          onTouchCancel={() => { setPressedBtn(null); stopFB() }}
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
          onMouseDown={() => { playReg(); setPressedBtn('ff'); startFF() }}
          onMouseUp={() => { setPressedBtn(null); stopFF() }}
          onMouseLeave={() => { setPressedBtn(null); stopFF() }}
          onTouchStart={() => { setPressedBtn('ff'); startFF() }}
          onTouchEnd={() => { setPressedBtn(null); stopFF() }}
          onTouchCancel={() => { setPressedBtn(null); stopFF() }}
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
