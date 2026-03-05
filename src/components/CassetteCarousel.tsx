import { useCallback, useRef, useEffect } from 'react'
import { motion, useMotionValue, animate } from 'framer-motion'
import { useMusicStore } from '../store/musicStore'
import { usePlayerStore } from '../store/playerStore'
import { loadCassetteQueue } from '../services/appleMusic'
import { useKeyboardNav } from '../hooks/useKeyboardNav'
import type { Cassette } from '../types/music'

const CASSETTE_WIDTH = 220
const CASSETTE_GAP = 32
const ITEM_WIDTH = CASSETTE_WIDTH + CASSETTE_GAP

export function CassetteCarousel() {
  const cassettes = useMusicStore((s) => s.cassettes)
  const selectedIndex = useMusicStore((s) => s.selectedCassetteIndex)
  const setSelectedIndex = useMusicStore((s) => s.setSelectedIndex)
  const isInserted = usePlayerStore((s) => s.isInserted)
  const currentCassette = usePlayerStore((s) => s.currentCassette)
  const insertCassette = usePlayerStore((s) => s.insertCassette)
  const setQueuedTracks = usePlayerStore((s) => s.setQueuedTracks)

  const x = useMotionValue(0)
  const dragConstraints = useRef<HTMLDivElement>(null)

  // Sync x position when selectedIndex changes (e.g. keyboard nav)
  useEffect(() => {
    animate(x, -(selectedIndex * ITEM_WIDTH), {
      type: 'spring',
      stiffness: 300,
      damping: 30,
    })
  }, [selectedIndex, x])

  const goLeft = useCallback(() => {
    setSelectedIndex(Math.max(0, selectedIndex - 1))
  }, [selectedIndex, setSelectedIndex])

  const goRight = useCallback(() => {
    setSelectedIndex(Math.min(cassettes.length - 1, selectedIndex + 1))
  }, [selectedIndex, cassettes.length, setSelectedIndex])

  useKeyboardNav(goLeft, goRight, !isInserted)

  async function handleInsert(cassette: Cassette) {
    insertCassette(cassette)
    const shuffled = await loadCassetteQueue(cassette, 0)
    setQueuedTracks(shuffled)
  }

  if (cassettes.length === 0) return null

  const totalWidth = cassettes.length * ITEM_WIDTH

  return (
    <div className="carousel-wrapper">
      <div className="carousel-track-container" ref={dragConstraints}>
        <motion.div
          className="carousel-track"
          drag="x"
          dragConstraints={dragConstraints}
          style={{ x, width: totalWidth }}
          onDragEnd={() => {
            const currentX = x.get()
            const index = Math.round(-currentX / ITEM_WIDTH)
            const clamped = Math.max(0, Math.min(cassettes.length - 1, index))
            setSelectedIndex(clamped)
            // The useEffect above will animate to the snapped position
          }}
        >
          {cassettes.map((cassette, i) => (
            <CassetteItem
              key={cassette.id}
              cassette={cassette}
              isSelected={i === selectedIndex}
              isInserted={isInserted && currentCassette?.id === cassette.id}
              onInsert={() => handleInsert(cassette)}
            />
          ))}
        </motion.div>
      </div>

      <div className="carousel-nav">
        <button
          className="nav-arrow"
          onClick={goLeft}
          disabled={selectedIndex === 0}
        >
          &#8592;
        </button>
        <span className="carousel-counter">{selectedIndex + 1} / {cassettes.length}</span>
        <button
          className="nav-arrow"
          onClick={goRight}
          disabled={selectedIndex === cassettes.length - 1}
        >
          &#8594;
        </button>
      </div>
    </div>
  )
}

interface CassetteItemProps {
  cassette: Cassette
  isSelected: boolean
  isInserted: boolean
  onInsert: () => void
}

function CassetteItem({ cassette, isSelected, isInserted, onInsert }: CassetteItemProps) {
  return (
    <motion.div
      className="cassette-item"
      animate={{
        y: isSelected ? -12 : 0,
        scale: isSelected ? 1.05 : 0.95,
        opacity: isInserted ? 0 : 1,
      }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
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

      {isSelected && !isInserted && (
        <button className="insert-button" onClick={onInsert}>
          Insert Tape
        </button>
      )}
    </motion.div>
  )
}
