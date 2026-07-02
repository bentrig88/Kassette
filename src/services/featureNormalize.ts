/**
 * Library-relative feature normalization.
 *
 * analyzeBuffer() stores RAW measurements (actual BPM, linear RMS, zero-crossing
 * rate) — values whose absolute magnitude is hard to map to a meaningful 0–100
 * scale with a fixed constant (most tracks cluster in a narrow band, so a global
 * constant makes the sliders feel unresponsive).
 *
 * Instead we normalize each raw value to its PERCENTILE RANK within the user's
 * own analyzed library: 0 = lowest in the library, 100 = highest. This
 * self-calibrates to the music the user actually has, so the Pace/Energy/Mood
 * sliders always span the full range and discriminate well.
 */
import type { TrackFeatures } from './featureCache'

export interface NormalizedFeatures {
  pace: number   // 0–100 percentile of BPM across the library
  energy: number // 0–100 percentile of raw energy (RMS)
  mood: number   // 0–100 percentile of raw mood (ZCR brightness proxy)
}

export interface FeatureNormalizer {
  /** Number of analyzed tracks the distribution was built from. */
  count: number
  normalize: (f: TrackFeatures) => NormalizedFeatures
}

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
 * rebuild (one sort per metric); memoize on `featuresMap` at the call site.
 */
export function buildNormalizer(featuresMap: Map<string, TrackFeatures>): FeatureNormalizer {
  const bpms: number[] = []
  const energies: number[] = []
  const moods: number[] = []
  for (const f of featuresMap.values()) {
    if (f.unanalyzable) continue // tombstones carry zeroed sentinels, not data
    bpms.push(f.bpm)
    energies.push(f.energyRaw)
    moods.push(f.moodRaw)
  }
  bpms.sort((a, b) => a - b)
  energies.sort((a, b) => a - b)
  moods.sort((a, b) => a - b)

  return {
    count: bpms.length,
    normalize: (f: TrackFeatures): NormalizedFeatures => ({
      pace: percentile(bpms, f.bpm),
      energy: percentile(energies, f.energyRaw),
      mood: percentile(moods, f.moodRaw),
    }),
  }
}
