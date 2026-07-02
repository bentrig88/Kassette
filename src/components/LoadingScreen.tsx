import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { Track } from '../types/music'
import { buildNormalizer } from '../services/featureNormalize'
import { useAssetPreloader } from '../hooks/useAssetPreloader'
import { LoadingTape } from './LoadingTape'
import type { ScreenTrack, ScreenMeta } from './TrackScreen'
import authBg from '../assets/auth/auth-background.webp'
import { usePlayerStore } from '../store/playerStore'

const INTRO_MS = 1000        // red phase duration before crossfade to concrete
const CYCLE_MS = 450         // LCD track cycle interval

interface Props {
  libraryProgress: number   // 0–100
  libraryDone: boolean
  tracksPool: Track[]
  /** Focused genre's tape-selection background (null until cassettes exist). */
  firstBackgroundUrl: string | null
  onComplete: () => void
}

/** A random integer in [min, max]. Index-free, purely visual. */
function randInt(min: number, max: number) {
  return Math.floor(min + Math.random() * (max - min + 1))
}

export function LoadingScreen({ libraryProgress, libraryDone, tracksPool, firstBackgroundUrl, onComplete }: Props) {
  const featuresMap = usePlayerStore((s) => s.featuresMap)
  const [phase, setPhase] = useState<'red' | 'concrete'>('red')
  const [exiting, setExiting] = useState(false)
  const [now, setNow] = useState<ScreenTrack | null>(null)
  const [next, setNext] = useState<ScreenTrack | null>(null)
  const [nowMeta, setNowMeta] = useState<ScreenMeta | null>(null)
  const [nextMeta, setNextMeta] = useState<ScreenMeta | null>(null)

  const { progress: assetProgress, done: assetDone } = useAssetPreloader()
  // Rebuild the normalizer (3 full sorts) only every 50 new analyses, not on
  // every featuresMap change — it's read solely by the 450ms LCD tick, where
  // percentile drift of a few tracks is invisible.
  const analyzedCount = usePlayerStore((s) => s.analyzedCount)
  const normBucket = Math.floor(analyzedCount / 50)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const normalizer = useMemo(() => buildNormalizer(usePlayerStore.getState().featuresMap), [normBucket])

  // Keep the latest pool/features/normalizer in refs so the cycle interval
  // (set up once) always reads fresh values without resetting.
  const poolRef = useRef(tracksPool)
  const featRef = useRef(featuresMap)
  const normRef = useRef(normalizer)
   
  poolRef.current = tracksPool
   
  featRef.current = featuresMap
   
  normRef.current = normalizer

  // Phase: red → concrete after the intro beat.
  useEffect(() => {
    const t = setTimeout(() => setPhase('concrete'), INTRO_MS)
    return () => clearTimeout(t)
  }, [])

  // Fast LCD cycling — real meta if cached, else an honest placeholder (null →
  // the LCD's dim "—"; fabricated random numbers used to contradict what the
  // player later shows for the same track).
  useEffect(() => {
    function metaFor(track: Track | undefined): ScreenMeta | null {
      if (track) {
        const f = featRef.current.get(track.id)
        if (f && !f.unanalyzable) {
          const n = normRef.current.normalize(f)
          return { bpm: f.bpm, nrg: n.energy, mood: n.mood }
        }
      }
      return null
    }
    function toScreen(t: Track | undefined): ScreenTrack | null {
      return t ? { name: t.name, artistName: t.artistName } : null
    }
    function tick() {
      const pool = poolRef.current
      if (pool.length === 0) return
      const a = pool[randInt(0, pool.length - 1)]
      const b = pool[randInt(0, pool.length - 1)]
      setNow(toScreen(a)); setNowMeta(metaFor(a))
      setNext(toScreen(b)); setNextMeta(metaFor(b))
    }
    tick()
    const id = setInterval(tick, CYCLE_MS)
    return () => clearInterval(id)
  }, [])

  // The tape-selection screen's focused genre background is lazy-loaded; if
  // the overlay drops before that photo is decoded, the player blinks through
  // the transparent background layer for a few frames. Hold the exit until
  // it's fully decoded (safety timeout so a failed image can't trap the user).
  const [bgReady, setBgReady] = useState(false)
  useEffect(() => {
    if (!firstBackgroundUrl) return
    let cancelled = false
    const ready = () => { if (!cancelled) setBgReady(true) }
    const img = new Image()
    img.src = firstBackgroundUrl
    img.decode().then(ready, ready)
    const safety = setTimeout(ready, 5000)
    return () => { cancelled = true; clearTimeout(safety) }
  }, [firstBackgroundUrl])

  // Begin the exit fade when library + assets + the focused genre background
  // are ready AND the intro elapsed. The player is already mounted underneath
  // (App renders it once cassettes exist), so fading .ls-root out crossfades
  // to it. (No firstBackgroundUrl with libraryDone = zero cassettes — the
  // empty state has no genre background to wait for.)
  const firedRef = useRef(false)
  useEffect(() => {
    if (firedRef.current) return
    if (libraryDone && assetDone && (firstBackgroundUrl ? bgReady : true) && phase === 'concrete') {
      firedRef.current = true
      setExiting(true)
    }
  }, [libraryDone, assetDone, bgReady, firstBackgroundUrl, phase])

  const combined = 0.5 * (Math.min(100, libraryProgress) / 100) + 0.5 * assetProgress
  const concrete = phase === 'concrete'

  return (
    <motion.div
      className="ls-root"
      initial={{ opacity: 1 }}
      animate={{ opacity: exiting ? 0 : 1 }}
      transition={{ duration: 0.45, ease: 'easeInOut' }}
      onAnimationComplete={() => { if (exiting) onComplete() }}
    >
      {/* Background layers: red (state 1) crossfades to concrete (state 2). */}
      <div className="ls-bg ls-bg-red" style={{ opacity: concrete ? 0 : 1 }} />
      <div className="ls-bg ls-bg-concrete" style={{ opacity: concrete ? 1 : 0 }}>
        <div className="ls-bg-concrete-img" style={{ backgroundImage: `url(${authBg})` }} />
        <div className="ls-bg-concrete-grad" />
      </div>

      {/* Heading — fades in with the concrete phase. */}
      <div className="ls-heading" style={{ opacity: concrete ? 1 : 0 }}>
        <div className="ls-heading-top">LOADING YOUR LIBRARY</div>
        <div className="ls-heading-main">BUILDING YOUR KASSETTES</div>
      </div>

      {/* Tape — fades in on mount, drifts + rotates, shadow animates in on concrete. */}
      <motion.div
        className="ls-tape-wrap"
        initial={{ opacity: 0 }}
        animate={{
          opacity: 1,
          x: [-10, 12],
          y: [-8, 10],
          rotate: [-2, 2.5],
        }}
        transition={{
          opacity: { duration: 0.6, ease: 'easeOut' },
          x: { duration: 5, ease: 'easeInOut', repeat: Infinity, repeatType: 'reverse' },
          y: { duration: 6, ease: 'easeInOut', repeat: Infinity, repeatType: 'reverse' },
          rotate: { duration: 7, ease: 'easeInOut', repeat: Infinity, repeatType: 'reverse' },
        }}
      >
        <motion.div
          animate={{ filter: concrete ? 'drop-shadow(0 40px 55px rgba(0,0,0,0.5))' : 'drop-shadow(0 0px 0px rgba(0,0,0,0))' }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        >
          <LoadingTape progress={combined} now={now} next={next} nowMeta={nowMeta} nextMeta={nextMeta} />
        </motion.div>
      </motion.div>
    </motion.div>
  )
}
