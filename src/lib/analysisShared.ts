// Shared analysis resources so the active-queue pass and the background pass
// don't each spin up their own AudioContext or double-analyze the same track.

let ctx: AudioContext | null = null

/** One long-lived AudioContext for decoding preview clips (never closed). */
export function getSharedAudioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  return ctx
}

const inFlight = new Set<string>()

/** Claim a track for analysis. Returns false if another pass is already on it. */
export function beginAnalysis(id: string): boolean {
  if (inFlight.has(id)) return false
  inFlight.add(id)
  return true
}

/** Release a track once analysis (or its failure) is done. */
export function endAnalysis(id: string): void {
  inFlight.delete(id)
}
