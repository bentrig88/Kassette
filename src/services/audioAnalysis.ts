/**
 * Pure audio feature extraction on raw mono PCM (Float32Array), running inside
 * the analysis Web Worker via Essentia.js (WASM port of the Essentia MIR
 * library). Returns RAW measurements; absolute 0–100 scaling happens
 * library-relative in featureNormalize.ts.
 *
 * bpm           — RhythmExtractor2013 (multifeature or degara), clamped to 50–200
 * bpmConfidence — RhythmExtractor2013 confidence rescaled to 0–1 (raw 0–5.32)
 * Raw components (loudness, onsetRate, dynamicComplexity, centroidHz,
 * modeScore, danceability) are stored per track; the Energy/Mood slider
 * values are composed from library percentiles in featureNormalize.ts, so
 * blend weights can be re-tuned without re-analysis.
 *
 * Expects 44100 Hz input: RhythmExtractor2013 has no sampleRate param and
 * assumes 44100 (analysisClient's TARGET_RATE matches).
 */
import Essentia from 'essentia.js/dist/essentia.js-core.es.js'
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js'
import type { TrackFeatures } from './featureCache'

// RhythmExtractor2013 'multifeature' confidence is on a 0–5.32 scale.
const CONFIDENCE_MAX = 5.32

// One Essentia instance per worker, created lazily and reused. The WASM module
// is base64-embedded in the ES build and instantiates synchronously, but keep
// the factory-vs-object handling in case a future version changes shape.
let essentiaPromise: Promise<Essentia> | null = null
function getEssentia(): Promise<Essentia> {
  if (!essentiaPromise) {
    essentiaPromise = (async () => {
      const wasm =
        typeof EssentiaWASM === 'function'
          ? await (EssentiaWASM as () => Promise<unknown>)()
          : EssentiaWASM
      return new Essentia(wasm)
    })()
  }
  return essentiaPromise
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

export type RhythmMethod = 'multifeature' | 'degara'

/**
 * Analyzes raw mono 44.1 kHz PCM and returns raw BPM / energy / mood measurements.
 *
 * `method` picks the RhythmExtractor2013 flavor: 'multifeature' (most accurate,
 * ~2s/clip, returns a confidence) for the active cassette; 'degara' (~4-5x
 * faster, NO confidence — the field is omitted) for the background
 * whole-library pass.
 */
export async function analyzePCM(
  id: string,
  data: Float32Array,
  sampleRate: number,
  method: RhythmMethod = 'multifeature',
): Promise<TrackFeatures> {
  const essentia = await getEssentia()
  const signal = essentia.arrayToVector(data)
  try {
    // ── BPM + confidence ────────────────────────────────────────
    const rhythm = essentia.RhythmExtractor2013(signal, 208, method, 40)
    rhythm.ticks.delete()
    rhythm.estimates.delete()
    rhythm.bpmIntervals.delete()
    const bpm = Math.round(Math.min(200, Math.max(50, rhythm.bpm)))
    // degara always reports 0 — omit the field rather than store a false
    // "no confidence" (the sort treats absent as fully confident).
    const bpmConfidence = method === 'multifeature' ? clamp01(rhythm.confidence / CONFIDENCE_MAX) : undefined

    // ── Raw components (percentile-ranked + blended in featureNormalize) ──
    const loudness = essentia.Loudness(signal).loudness

    const onsets = essentia.OnsetRate(signal)
    onsets.onsets.delete()
    const onsetRate = onsets.onsetRate

    const dynamicComplexity = essentia.DynamicComplexity(signal).dynamicComplexity

    const { scale, strength } = essentia.KeyExtractor(signal)
    const modeScore = clamp01(scale === 'major' ? 0.5 + 0.5 * strength : 0.5 - 0.5 * strength)

    const centroidHz = essentia.SpectralCentroidTime(signal, sampleRate).centroid

    const dance = essentia.Danceability(signal)
    dance.dfa.delete()
    const danceability = dance.danceability

    return {
      id, bpm, bpmConfidence, loudness, onsetRate, dynamicComplexity,
      centroidHz, modeScore, danceability, analyzedAt: Date.now(),
    }
  } finally {
    signal.delete()
  }
}
