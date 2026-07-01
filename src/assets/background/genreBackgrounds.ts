// Single source of truth for genre → tape-selection background photo.
// Edit genreBackgroundMap to reassign a photo to a genre.
import bgGeneric from './background-generic.webp'
import tapeBackRock from './tape_back_rock.webp'
import tapeBackHiphop from './tape_back_hiphop.webp'
import tapeBackElectro from './tape_back_electro.webp'
import tapeBackReggae from './tape_back_reggae.webp'
import tapeBackClassical from './tape_back_classical.webp'
import tapeBackFolk from './tape_back_folk.webp'
import tapeBackJazz from './tape_back_jazz.webp'
import tapeBackPop from './tape_back_pop.webp'

export const genreBackgroundMap: Record<string, string> = {
  'Rock': tapeBackRock,
  'Hip-Hop': tapeBackHiphop,
  'Electronic': tapeBackElectro,
  'Reggae': tapeBackReggae,
  'Classical': tapeBackClassical,
  'Folk': tapeBackFolk,
  'Jazz': tapeBackJazz,
  'Pop': tapeBackPop,
}

export function backgroundForGenre(genre: string): string {
  return genreBackgroundMap[genre] ?? bgGeneric
}

// Direction of the wipe when the carousel moves from index `prev` to `next`
// across `n` genres, taking the shortest path around the ring so wrapping
// from the last tape to the first still reads as "right".
export function getWipeDirection(prev: number, next: number, n: number): 'left' | 'right' {
  if (n <= 1 || prev === next) return 'right'
  const rightDist = (((next - prev) % n) + n) % n
  const leftDist = (((prev - next) % n) + n) % n
  return rightDist <= leftDist ? 'right' : 'left'
}
