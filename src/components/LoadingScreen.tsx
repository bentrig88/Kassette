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
  onComplete: () => void
}

/** A random integer in [min, max]. Index-free, purely visual. */
function randInt(min: number, max: number) {
  return Math.floor(min + Math.random() * (max - min + 1))
}

export function LoadingScreen({ libraryProgress, libraryDone, tracksPool, onComplete }: Props) {
  const featuresMap = usePlayerStore((s) => s.featuresMap)
  const [phase, setPhase] = useState<'red' | 'concrete'>('red')
  const [exiting, setExiting] = useState(false)
  const [now, setNow] = useState<ScreenTrack | null>(null)
  const [next, setNext] = useState<ScreenTrack | null>(null)
  const [nowMeta, setNowMeta] = useState<ScreenMeta | null>(null)
  const [nextMeta, setNextMeta] = useState<ScreenMeta | null>(null)

  const { progress: assetProgress, done: assetDone } = useAssetPreloader()
  const normalizer = useMemo(() => buildNormalizer(featuresMap), [featuresMap])

  // Keep the latest pool/features/normalizer in refs so the cycle interval
  // (set up once) always reads fresh values without resetting.
  const poolRef = useRef(tracksPool)
  const featRef = useRef(featuresMap)
  const normRef = useRef(normalizer)
  // eslint-disable-next-line react-hooks/refs
  poolRef.current = tracksPool
  // eslint-disable-next-line react-hooks/refs
  featRef.current = featuresMap
  // eslint-disable-next-line react-hooks/refs
  normRef.current = normalizer

  // Phase: red → concrete after the intro beat.
  useEffect(() => {
    const t = setTimeout(() => setPhase('concrete'), INTRO_MS)
    return () => clearTimeout(t)
  }, [])

  // Fast LCD cycling — real meta if cached, else random.
  useEffect(() => {
    function metaFor(track: Track | undefined): ScreenMeta {
      if (track) {
        const f = featRef.current.get(track.id)
        if (f && !f.unanalyzable) {
          const n = normRef.current.normalize(f)
          return { bpm: f.bpm, nrg: n.energy, mood: n.mood }
        }
      }
      return { bpm: randInt(60, 180), nrg: randInt(0, 100), mood: randInt(0, 100) }
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

  // Begin the exit fade when library + assets are ready AND the intro elapsed.
  // The player is already mounted underneath (App renders it once cassettes
  // exist), so fading .ls-root out crossfades to it.
  const firedRef = useRef(false)
  useEffect(() => {
    if (firedRef.current) return
    if (libraryDone && assetDone && phase === 'concrete') {
      firedRef.current = true
      setExiting(true)
    }
  }, [libraryDone, assetDone, phase])

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
