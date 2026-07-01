import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { useMusicStore } from '../store/musicStore'
import { usePlayerStore } from '../store/playerStore'
import { backgroundForGenre, getWipeDirection } from '../assets/background/genreBackgrounds'

interface GenreBackgroundProps {
  isInserting: boolean
}

type WipeDir = 'left' | 'right' | 'none'
interface Layer {
  id: number
  src: string
  direction: WipeDir
}

// Slant of the diagonal seam, as a percentage of width. Higher = steeper diagonal.
const SLANT = 35

// Mouse parallax. The photo layer is scaled up by PARALLAX_SCALE so the
// ±MAX_SHIFT% translation can never expose an edge: the scale overflows each
// side by (PARALLAX_SCALE - 1) / 2 (= 5%), which must exceed MAX_SHIFT (= 3%).
const MAX_SHIFT = 3
const PARALLAX_SCALE = 1.1

// clip-path polygon for the incoming photo. Each polygon has 4 vertices so
// Framer can interpolate start → end vertex-by-vertex, sweeping the seam.
function clipPath(direction: WipeDir, phase: 'start' | 'end'): string {
  const full = 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)'
  if (direction === 'none') return full
  if (direction === 'right') {
    // Visible (new) region is to the RIGHT of the seam; seam sweeps right → left.
    return phase === 'start'
      ? `polygon(${100 + SLANT}% 0%, 100% 0%, 100% 100%, 100% 100%)`
      : `polygon(0% 0%, 100% 0%, 100% 100%, ${-SLANT}% 100%)`
  }
  // left: visible region is to the LEFT of the seam; seam sweeps left → right.
  return phase === 'start'
    ? `polygon(0% 0%, ${-SLANT}% 0%, 0% 100%, 0% 100%)`
    : `polygon(0% 0%, 100% 0%, ${100 + SLANT}% 100%, 0% 100%)`
}

export function GenreBackground({ isInserting }: GenreBackgroundProps) {
  const cassettes = useMusicStore((s) => s.cassettes)
  const selectedIndex = useMusicStore((s) => s.selectedCassetteIndex)
  const isInserted = usePlayerStore((s) => s.isInserted)

  const n = cassettes.length
  const genre = cassettes[selectedIndex]?.genre
  const src = genre ? backgroundForGenre(genre) : null

  const prevIndexRef = useRef(selectedIndex)
  const prevSrcRef = useRef<string | null>(null)
  const idRef = useRef(0)
  const [layers, setLayers] = useState<Layer[]>([])

  // Seed the first layer, and push an incoming wipe layer on each genre change.
  // Ref bookkeeping lives in the effect body, NOT inside a setLayers updater:
  // StrictMode double-invokes updaters in dev, which would advance prevIndexRef
  // before the direction is computed and collapse every wipe to 'right'.
  useEffect(() => {
    if (!src || n === 0) return

    // First layer — appears without a wipe.
    if (prevSrcRef.current === null) {
      prevSrcRef.current = src
      prevIndexRef.current = selectedIndex
      setLayers([{ id: ++idRef.current, src, direction: 'none' }])
      return
    }

    // Same photo (two genres can share one) → no wipe; keep prev index current.
    if (prevSrcRef.current === src) {
      prevIndexRef.current = selectedIndex
      return
    }

    const direction = getWipeDirection(prevIndexRef.current, selectedIndex, n)
    prevIndexRef.current = selectedIndex
    prevSrcRef.current = src
    const id = ++idRef.current
    setLayers((cur) => [...cur, { id, src, direction }])
  }, [src, selectedIndex, n])

  // Subtle mouse parallax, smoothed with a spring. Background drifts opposite
  // to the cursor for a sense of depth.
  const mvX = useMotionValue(0)
  const mvY = useMotionValue(0)
  const springX = useSpring(mvX, { stiffness: 60, damping: 20, mass: 0.5 })
  const springY = useSpring(mvY, { stiffness: 60, damping: 20, mass: 0.5 })
  const shiftX = useTransform(springX, [-1, 1], [`${MAX_SHIFT}%`, `${-MAX_SHIFT}%`])
  const shiftY = useTransform(springY, [-1, 1], [`${MAX_SHIFT}%`, `${-MAX_SHIFT}%`])

  // Prefetch the focused background + its ring neighbors so navigation is
  // seamless (these are no longer eagerly preloaded during the loading screen).
  useEffect(() => {
    if (n === 0) return
    for (const di of [0, -1, 1]) {
      const g = cassettes[((selectedIndex + di) % n + n) % n]?.genre
      const url = g ? backgroundForGenre(g) : null
      if (url) { const img = new Image(); img.src = url }
    }
  }, [cassettes, selectedIndex, n])

  useEffect(() => {
    function onMove(e: MouseEvent) {
      mvX.set((e.clientX / window.innerWidth) * 2 - 1)
      mvY.set((e.clientY / window.innerHeight) * 2 - 1)
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [mvX, mvY])

  const visible = !isInserted && !isInserting

  return (
    <AnimatePresence>
      {visible && layers.length > 0 && (
        <motion.div
          key="genre-bg"
          className="genre-bg-root"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          <motion.div
            className="genre-bg-parallax"
            style={{ x: shiftX, y: shiftY, scale: PARALLAX_SCALE }}
          >
            {layers.map((layer, i) => {
            const isTop = i === layers.length - 1
            const wipes = isTop && layer.direction !== 'none'
            return (
              <motion.img
                key={layer.id}
                src={layer.src}
                alt=""
                className="genre-bg-photo"
                initial={wipes ? { clipPath: clipPath(layer.direction, 'start') } : false}
                animate={{ clipPath: clipPath(layer.direction, 'end') }}
                transition={{ duration: 0.3, ease: [0, 0, 0.58, 1] }}
                onAnimationComplete={() => {
                  // Once THIS layer is the current top and has finished wiping in,
                  // drop the now-hidden layers beneath it. Keyed on the stable
                  // layer.id (not a render-time isTop/length snapshot) so rapid
                  // tape-switching cannot prune a layer that is still animating.
                  setLayers((cur) =>
                    cur.length > 1 && cur[cur.length - 1].id === layer.id
                      ? cur.slice(-1)
                      : cur,
                  )
                }}
              />
            )
            })}
          </motion.div>
          {/* Dark scrim — opacity tunable via the debug panel (default 1) */}
          <div className="genre-bg-scrim" />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
