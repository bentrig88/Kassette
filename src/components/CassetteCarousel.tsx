import { useCallback, useRef, useEffect, useState } from 'react'
import { motion, useMotionValue, animate, AnimatePresence } from 'framer-motion'
import type { AnimationPlaybackControls } from 'framer-motion'
import { useMusicStore } from '../store/musicStore'
import { usePlayerStore } from '../store/playerStore'
import { loadCassetteQueue } from '../services/appleMusic'
import { useKeyboardNav } from '../hooks/useKeyboardNav'
import type { Cassette } from '../types/music'

const BASE_CASSETTE_GAP = 100
const BASE_CASSETTE_HEIGHT = 140
const SPRING = { type: 'spring' as const, stiffness: 300, damping: 30 }

function getCassetteDims() {
  const height = window.innerHeight * 0.22
  const width = Math.round(height * 15 / 10)
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
    insertCassette(cassette)
    const shuffled = await loadCassetteQueue(cassette, 0)
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
        {!isInserted && (
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
        {!isInserted && (
          <motion.div
            key="carousel-wrapper"
            className="carousel-wrapper"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
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
                    />
                  )
                })}
              </motion.div>
            </div>

            <div className="carousel-nav">
              <button className="nav-arrow" onClick={goLeft}>&#8592;</button>
              <button className="nav-arrow" onClick={goRight}>&#8594;</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedCassette && !selectedIsInserted && (
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

interface CassetteItemProps {
  cassette: Cassette
  isSelected: boolean
  isInserted: boolean
  isMiddle: boolean
  width: number
}

function CassetteItem({ cassette, isSelected, isInserted, isMiddle, width }: CassetteItemProps) {
  return (
    <div className="cassette-item" style={{ width }}>
      <AnimatePresence>
        {!isInserted && (
          <motion.div
            layoutId={isMiddle ? `cassette-${cassette.id}` : undefined}
            animate={{
              y: isSelected ? -12 : 0,
              scale: isSelected ? 1.05 : 0.95,
            }}
            transition={SPRING}
          >
            <div className="cassette-body" style={{ borderColor: cassette.color }}>
              <div className="cassette-label" style={{ backgroundColor: cassette.color }}>
                <span className="cassette-genre">{cassette.genre}</span>
                <span className="cassette-count">{cassette.tracks.length} tracks</span>
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
    </div>
  )
}
