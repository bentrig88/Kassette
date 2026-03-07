import { useCallback, useRef, useEffect, useState } from 'react'
import { motion, useMotionValue, animate, AnimatePresence } from 'framer-motion'
import type { AnimationPlaybackControls } from 'framer-motion'
import { useMusicStore } from '../store/musicStore'
import { usePlayerStore } from '../store/playerStore'
import { loadCassetteQueue } from '../services/appleMusic'
import { useKeyboardNav } from '../hooks/useKeyboardNav'
import type { Cassette } from '../types/music'
import { CassetteTapeBody } from './CassetteTapeBody'

const BASE_CASSETTE_GAP = 100
const BASE_CASSETTE_HEIGHT = 140
const SPRING = { type: 'spring' as const, stiffness: 300, damping: 30 }

function getCassetteDims() {
  const height = window.innerHeight * 0.22
  const width = Math.round(height * 550 / 342) // matches cassette-body--new aspect-ratio
  const gap = Math.round(height * BASE_CASSETTE_GAP / BASE_CASSETTE_HEIGHT)
  return { width, gap, itemWidth: width + gap }
}

export function CassetteCarousel() {
  const cassettes = useMusicStore((s) => s.cassettes)
  const selectedIndex = useMusicStore((s) => s.selectedCassetteIndex)
  const setSelectedIndex = useMusicStore((s) => s.setSelectedIndex)
  const isInserted = usePlayerStore((s) => s.isInserted)
  const currentCassette = usePlayerStore((s) => s.currentCassette)
  const insertCassette = usePlayerStore((s) => s.insertCassette)
  const setQueuedTracks = usePlayerStore((s) => s.setQueuedTracks)
  const setInsertSourceRect = usePlayerStore((s) => s.setInsertSourceRect)

  const [isInserting, setIsInserting] = useState(false)
  // y offset (px) that moves the selected cassette to 110px from viewport top.
  // Computed from cassette-item's natural layout position before animation starts.
  const liftYRef = useRef(0)

  // Reset isInserting when the cassette is ejected so the carousel reopens cleanly
  useEffect(() => {
    if (!isInserted) setIsInserting(false)
  }, [isInserted])

  const N = cassettes.length

  const [dims, setDims] = useState(getCassetteDims)
  const dimsRef = useRef(dims)
  dimsRef.current = dims

  const [windowWidth, setWindowWidth] = useState(window.innerWidth)
  useEffect(() => {
    function update() {
      setDims(getCassetteDims())
      setWindowWidth(window.innerWidth)
    }
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // virtualIndex lives in the tripled array. Middle set = [N, 2N).
  const [virtualIndex, setVirtualIndex] = useState(() => N + selectedIndex)
  const virtualIndexRef = useRef(N + selectedIndex)
  virtualIndexRef.current = virtualIndex

  const x = useMotionValue(N > 0 ? -((N + selectedIndex) * dims.itemWidth) : 0)
  const prevItemWidthRef = useRef(dims.itemWidth)

  // Running animation controls — stopped before starting a new one.
  const animControls = useRef<AnimationPlaybackControls | null>(null)
  // Incremented each time we start a new animation. Lets onComplete detect staleness.
  const animVersionRef = useRef(0)
  // Set true before a silent teleport so the sync effect skips re-animating.
  const isTeleportingRef = useRef(false)

  // Animate x whenever virtualIndex or itemWidth changes.
  // When the animation finishes, silently teleport back to the middle set if needed.
  useEffect(() => {
    if (isTeleportingRef.current) {
      isTeleportingRef.current = false
      return
    }
    const isResize = prevItemWidthRef.current !== dims.itemWidth
    prevItemWidthRef.current = dims.itemWidth
    animControls.current?.stop()
    if (isResize) {
      x.set(-(virtualIndexRef.current * dims.itemWidth))
      return
    }
    const version = ++animVersionRef.current
    animControls.current = animate(x, -(virtualIndex * dims.itemWidth), {
      ...SPRING,
      onComplete: () => {
        if (animVersionRef.current !== version) return
        const vi = virtualIndexRef.current
        if (vi < N || vi >= 2 * N) {
          // Normalise vi into middle set [N, 2N)
          const normalVi = ((vi % N) + N) % N + N
          animControls.current = null
          isTeleportingRef.current = true
          x.set(-(normalVi * dimsRef.current.itemWidth))
          setVirtualIndex(normalVi)
          virtualIndexRef.current = normalVi
        }
      },
    })
  // setVirtualIndex is stable (useState setter); N is stable after library loads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtualIndex, dims.itemWidth, x, N])

  // Snap instantly on viewport width change
  useEffect(() => {
    animControls.current?.stop()
    x.set(-(virtualIndexRef.current * dimsRef.current.itemWidth))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowWidth])

  const goLeft = useCallback(() => {
    const newVi = Math.max(0, virtualIndexRef.current - 1)
    setVirtualIndex(newVi)
    virtualIndexRef.current = newVi
    setSelectedIndex(((newVi % N) + N) % N)
  }, [N, setSelectedIndex])

  const goRight = useCallback(() => {
    const newVi = Math.min(3 * N - 1, virtualIndexRef.current + 1)
    setVirtualIndex(newVi)
    virtualIndexRef.current = newVi
    setSelectedIndex(((newVi % N) + N) % N)
  }, [N, setSelectedIndex])

  useKeyboardNav(goLeft, goRight, !isInserted)

  async function handleInsert(cassette: Cassette) {
    // Measure cassette-item's static layout position to compute the lift offset.
    // We use the cassette-item wrapper (no transforms applied) so liftY is accurate.
    const el = document.querySelector('[data-insert-target]') as HTMLElement | null
    if (el) {
      const rect = el.getBoundingClientRect()
      liftYRef.current = 110 - rect.top
    }
    setIsInserting(true)
    // Start loading queue in parallel with the carousel lift animation
    const queuePromise = loadCassetteQueue(cassette, 0)
    // Wait for the lift animation (400ms) to finish, plus queue loading
    const [shuffled] = await Promise.all([
      queuePromise,
      new Promise<void>(resolve => setTimeout(resolve, 500)),
    ])
    // Measure the motion.div's ACTUAL rendered position after the lift animation.
    // data-flip-source is on the motion.div so getBoundingClientRect() includes
    // the translateY from the lift — this is the FLIP source position.
    const flipEl = document.querySelector('[data-flip-source]') as HTMLElement | null
    if (flipEl) {
      const rect = flipEl.getBoundingClientRect()
      setInsertSourceRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
    }
    // React 18 batches these into one render
    insertCassette(cassette)
    setQueuedTracks(shuffled)
  }

  if (cassettes.length === 0) return null

  const extendedCassettes = [...cassettes, ...cassettes, ...cassettes]
  const totalWidth = extendedCassettes.length * dims.itemWidth
  const realIndex = ((virtualIndex % N) + N) % N
  const selectedCassette = cassettes[realIndex]
  const selectedIsInserted = isInserted && currentCassette?.id === selectedCassette?.id

  return (
    <>
      <AnimatePresence>
        {!isInserted && !isInserting && (
          <motion.div
            key="blur-overlay"
            className="carousel-blur-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!isInserted && !isInserting && (
          <motion.div
            key="white-overlay"
            className="carousel-white-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!isInserted && (
          <motion.div
            key="carousel-wrapper"
            className="carousel-wrapper"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0 } }}
            transition={{ duration: 0.3 }}
          >
            <div
              className="carousel-track-container"
              style={{ padding: `0 calc(50% - ${dims.width / 2}px)` }}
            >
              <motion.div
                className="carousel-track"
                drag="x"
                style={{ x, width: totalWidth, gap: dims.gap }}
                onDragEnd={() => {
                  const currentX = x.get()
                  const rawIndex = Math.round(-currentX / dims.itemWidth)
                  const clamped = Math.max(0, Math.min(extendedCassettes.length - 1, rawIndex))
                  // Normalise to middle set immediately so we never drift
                  let targetVi = clamped
                  while (targetVi < N) targetVi += N
                  while (targetVi >= 2 * N) targetVi -= N
                  if (targetVi !== clamped) {
                    isTeleportingRef.current = true
                    x.set(-(targetVi * dimsRef.current.itemWidth))
                  }
                  setVirtualIndex(targetVi)
                  virtualIndexRef.current = targetVi
                  setSelectedIndex(targetVi - N)
                }}
              >
                {extendedCassettes.map((cassette, i) => {
                  const isMiddle = i >= N && i < 2 * N
                  const section = i < N ? 'pre' : i < 2 * N ? 'mid' : 'post'
                  return (
                    <CassetteItem
                      key={`${section}-${cassette.id}`}
                      cassette={cassette}
                      isSelected={i === virtualIndex}
                      isInserted={isMiddle && isInserted && currentCassette?.id === cassette.id}
                      isMiddle={isMiddle}
                      width={dims.width}
                      isInserting={isInserting}
                      selectedCassetteId={selectedCassette?.id}
                      liftY={liftYRef.current}
                      isInsertTarget={isMiddle && i === virtualIndex}
                    />
                  )
                })}
              </motion.div>
            </div>

            <motion.div
              className="carousel-nav"
              animate={{ opacity: isInserting ? 0 : 1 }}
              transition={{ duration: 0.3 }}
            >
              <button className="nav-arrow" onClick={goLeft}>&#8592;</button>
              <button className="nav-arrow" onClick={goRight}>&#8594;</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedCassette && !selectedIsInserted && !isInserting && (
          <motion.button
            key="insert-btn"
            className="insert-button insert-button--floating"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => handleInsert(selectedCassette)}
          >
            Insert Tape
          </motion.button>
        )}
      </AnimatePresence>
    </>
  )
}

// Seeded pseudo-random helpers for stable per-cassette levitation values
function stableHash(id: string) {
  return id.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0)
}
function pick(seed: number, max: number) {
  return (seed % (max * 2 + 1)) - max
}

interface CassetteItemProps {
  cassette: Cassette
  isSelected: boolean
  isInserted: boolean
  isMiddle: boolean
  width: number
  isInserting: boolean
  selectedCassetteId: string | undefined
  liftY: number
  isInsertTarget: boolean
}

function CassetteItem({ cassette, isSelected, isInserted, isMiddle, width, isInserting, selectedCassetteId, liftY, isInsertTarget }: CassetteItemProps) {
  const h = stableHash(cassette.id)

  // Independent per-cassette keyframe targets for x, y, rotate
  const x1 = pick(h * 7,        15), x2 = pick(h * 11 + 5,  15)
  const y1 = pick(h * 13,       15), y2 = pick(h * 17 + 3,  15)
  const r1 = pick(h * 3,         5), r2 = pick(h * 19 + 7,   5)
  // Staggered durations so axes drift out of phase (3–5 s each)
  const durX = 3 + (h % 3)
  const durY = 3 + ((h >> 4) % 3)
  const durR = 4 + ((h >> 8) % 3)

  // This tape should fade+shrink if inserting a different cassette
  const isExiting = isInserting && cassette.id !== selectedCassetteId

  return (
    // data-insert-target marks this element for DOM measurement in handleInsert
    <div className="cassette-item" style={{ width }} {...(isInsertTarget ? { 'data-insert-target': '' } : {})}>
      <AnimatePresence>
        {!isInserted && (
          <motion.div
            key={cassette.id}
            {...(isInsertTarget ? { 'data-flip-source': '' } : {})}
            animate={{
              y: isInserting && isSelected
                ? liftY
                : (isSelected ? -12 : 0),
              scale: isExiting ? 0.7 : (isSelected ? 1.05 : 0.95),
              opacity: isExiting ? 0 : 1,
            }}
            exit={{ opacity: 0, transition: { duration: 0.3 } }}
            transition={isExiting || (isInserting && isSelected)
              ? { duration: 0.4, ease: 'easeInOut' }
              : SPRING
            }
          >
            {/* Levitation layer — independent slow drift per cassette */}
            <motion.div
              animate={isInserting
                ? { x: 0, y: 0, rotate: 0 }
                : { x: [x1, x2], y: [y1, y2], rotate: [r1, r2] }
              }
              transition={isInserting
                ? { duration: 0.4, ease: 'easeInOut' }
                : {
                    x:      { duration: durX, ease: 'easeInOut', repeat: Infinity, repeatType: 'reverse' },
                    y:      { duration: durY, ease: 'easeInOut', repeat: Infinity, repeatType: 'reverse' },
                    rotate: { duration: durR, ease: 'easeInOut', repeat: Infinity, repeatType: 'reverse' },
                  }
              }
              style={{ filter: 'drop-shadow(0 45px 60px rgba(0,0,0,0.55))' }}
            >
              <div className="cassette-body cassette-body--new">
                <CassetteTapeBody cassette={cassette} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
