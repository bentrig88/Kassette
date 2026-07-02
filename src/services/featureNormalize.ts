/**
 * Library-relative feature normalization + slider composition.
 *
 * The cache stores RAW per-track components (see featureCache.TrackFeatures).
 * Each component is normalized to its PERCENTILE RANK within the user's own
 * analyzed library (0 = lowest, 100 = highest), then the three slider values
 * are composed as weighted blends of percentiles:
 *
 *   pace   = P(bpm)
 *   energy = 0.45·P(loudness) + 0.30·P(onsetRate) + 0.25·P(dynamicComplexity)
 *   mood   = 0.45·P(centroidHz) + 0.30·P(modeScore) + 0.25·P(danceability)
 *
 * Blending percentiles (not raw values) keeps units comparable, and because
 * the blend happens here — not in the analysis worker — the weights can be
 * re-tuned without re-analyzing the library.
 */
import type { TrackFeatures } from './featureCache'

export interface NormalizedFeatures {
  pace: number   // 0–100 percentile of BPM across the library
  energy: number // 0–100 drive/intensity blend (loudness + activity + dynamics)
  mood: number   // 0–100 sad→happy blend (brightness + mode + groove)
}

export interface FeatureNormalizer {
  /** Number of analyzed tracks the distribution was built from. */
  count: number
  normalize: (f: TrackFeatures) => NormalizedFeatures
}

export const ENERGY_WEIGHTS = { loudness: 0.45, onsetRate: 0.3, dynamicComplexity: 0.25 } as const
export const MOOD_WEIGHTS = { centroidHz: 0.45, modeScore: 0.3, danceability: 0.25 } as const

const COMPONENTS = ['bpm', 'loudness', 'onsetRate', 'dynamicComplexity', 'centroidHz', 'modeScore', 'danceability'] as const
type Component = (typeof COMPONENTS)[number]

/** Percentile rank of `v` in an ascending-sorted array: (count ≤ v) / n × 100. */
function percentile(sorted: number[], v: number): number {
  const n = sorted.length
  if (n <= 1) return 50 // not enough data to rank — treat as neutral
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] <= v) lo = mid + 1
    else hi = mid
  }
  return Math.round((lo / n) * 100)
}

/**
 * Build a normalizer from the current set of analyzed features. Cheap to
 * rebuild (one sort per component); memoize on `featuresMap` at the call site.
 */
export function buildNormalizer(featuresMap: Map<string, TrackFeatures>): FeatureNormalizer {
  const sorted: Record<Component, number[]> = {
    bpm: [], loudness: [], onsetRate: [], dynamicComplexity: [],
    centroidHz: [], modeScore: [], danceability: [],
  }
  for (const f of featuresMap.values()) {
    if (f.unanalyzable) continue // tombstones carry zeroed sentinels, not data
    for (const c of COMPONENTS) sorted[c].push(f[c])
  }
  for (const c of COMPONENTS) sorted[c].sort((a, b) => a - b)

  const P = (c: Component, f: TrackFeatures) => percentile(sorted[c], f[c])

  return {
    count: sorted.bpm.length,
    normalize: (f: TrackFeatures): NormalizedFeatures => ({
      pace: P('bpm', f),
      energy: Math.round(
        ENERGY_WEIGHTS.loudness * P('loudness', f) +
        ENERGY_WEIGHTS.onsetRate * P('onsetRate', f) +
        ENERGY_WEIGHTS.dynamicComplexity * P('dynamicComplexity', f),
      ),
      mood: Math.round(
        MOOD_WEIGHTS.centroidHz * P('centroidHz', f) +
        MOOD_WEIGHTS.modeScore * P('modeScore', f) +
        MOOD_WEIGHTS.danceability * P('danceability', f),
      ),
    }),
  }
}
