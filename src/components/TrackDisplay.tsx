import { memo, useMemo } from 'react'
import { usePlayerStore } from '../store/playerStore'
import { buildNormalizer } from '../services/featureNormalize'
import { TrackScreen } from './TrackScreen'
import type { Track } from '../types/music'
import type { TrackFeatures } from '../services/featureCache'

interface Props {
  currentTrack: Track | undefined
  nextTrack: Track | undefined
  currentTime: number
  duration: number
  progress: number
}

/**
 * Owns the featuresMap subscription + normalizer so the player shell doesn't
 * re-render on every analyzed track. Renders the shared now/next LCD.
 */
function TrackDisplayBase({ currentTrack, nextTrack, currentTime, duration, progress }: Props) {
  const featuresMap = usePlayerStore((s) => s.featuresMap)
  const normalizer = useMemo(() => buildNormalizer(featuresMap), [featuresMap])

  // Tombstoned tracks (no preview clip) have no real features — show NO
  // PREVIEW rather than the (false) ANALYZING… promise.
  const currentFeatures: TrackFeatures | undefined = currentTrack ? featuresMap.get(currentTrack.id) : undefined
  const currentNorm = currentFeatures && !currentFeatures.unanalyzable ? normalizer.normalize(currentFeatures) : undefined
  const nextFeatures: TrackFeatures | undefined = nextTrack ? featuresMap.get(nextTrack.id) : undefined
  const nextNorm = nextFeatures && !nextFeatures.unanalyzable ? normalizer.normalize(nextFeatures) : undefined

  return (
    <TrackScreen
      now={currentTrack ? { name: currentTrack.name, artistName: currentTrack.artistName } : null}
      nowTime={currentTime}
      nowDuration={duration}
      nowProgress={progress}
      nowMeta={currentFeatures && currentNorm
        ? { bpm: currentFeatures.bpm, nrg: currentNorm.energy, mood: currentNorm.mood }
        : null}
      nowMetaFallback={currentFeatures?.unanalyzable ? 'NO PREVIEW' : undefined}
      next={nextTrack ? { name: nextTrack.name, artistName: nextTrack.artistName } : null}
      nextMeta={nextFeatures && nextNorm
        ? { bpm: nextFeatures.bpm, nrg: nextNorm.energy, mood: nextNorm.mood }
        : null}
    />
  )
}

export const TrackDisplay = memo(TrackDisplayBase)
