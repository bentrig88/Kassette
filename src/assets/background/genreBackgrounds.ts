// Single source of truth for genre → tape-selection background photo.
// Edit genreBackgroundMap to reassign a photo to a genre.
import bgGeneric from './background-generic.jpg'
import tapeBackRock from './tape_back_rock.jpg'
import tapeBackHiphop from './tape_back_hiphop.jpg'
import tapeBackElectro from './tape_back_electro.jpg'
import tapeBackReggae from './tape_back_reggae.jpg'
import tapeBackClassical from './tape_back_classical.jpg'
import tapeBackFolk from './tape_back_folk.jpg'
import tapeBackJazz from './tape_back_jazz.jpg'
import tapeBackPop from './tape_back_pop.jpg'

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
