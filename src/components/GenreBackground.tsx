import { motion, AnimatePresence } from 'framer-motion'
import { useMusicStore } from '../store/musicStore'
import { usePlayerStore } from '../store/playerStore'
import { backgroundForGenre } from '../assets/background/genreBackgrounds'

interface GenreBackgroundProps {
  isInserting: boolean
}

export function GenreBackground({ isInserting }: GenreBackgroundProps) {
  const cassettes = useMusicStore((s) => s.cassettes)
  const selectedIndex = useMusicStore((s) => s.selectedCassetteIndex)
  const isInserted = usePlayerStore((s) => s.isInserted)

  const genre = cassettes[selectedIndex]?.genre
  const src = genre ? backgroundForGenre(genre) : null
  const visible = !isInserted && !isInserting

  return (
    <AnimatePresence>
      {visible && src && (
        <motion.div
          key="genre-bg"
          className="genre-bg-root"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          <img src={src} alt="" className="genre-bg-photo" />
          <div className="genre-bg-scrim" />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
