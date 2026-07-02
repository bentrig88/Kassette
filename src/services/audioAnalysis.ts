/**
 * Pure audio feature extraction on raw mono PCM (Float32Array), running inside
 * the analysis Web Worker via Essentia.js (WASM port of the Essentia MIR
 * library). Returns RAW measurements; absolute 0–100 scaling happens
 * library-relative in featureNormalize.ts.
 *
 * bpm           — RhythmExtractor2013 'multifeature', clamped to 50–200
 * bpmConfidence — RhythmExtractor2013 confidence rescaled to 0–1 (raw 0–5.32)
 * energyRaw     — Loudness (Steven's-law energy^0.67, a perceptual intensity)
 * moodRaw       — 0–1 blend of brightness (SpectralCentroidTime, 4 kHz ceiling)
 *                 and musical mode (KeyExtractor major/minor × strength):
 *                 0.6·brightness + 0.4·mode — same weighting as the old DSP so
 *                 the Mood slider's meaning is continuous.
 *
 * Expects 44100 Hz input: RhythmExtractor2013 has no sampleRate param and
 * assumes 44100 (analysisClient's TARGET_RATE matches).
 */
import Essentia from 'essentia.js/dist/essentia.js-core.es.js'
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js'
import type { TrackFeatures } from './featureCache'

// RhythmExtractor2013 'multifeature' confidence is on a 0–5.32 scale.
const CONFIDENCE_MAX = 5.32
// Spectral-centroid Hz ceiling for the 0–1 brightness term. The exact value is
// uncritical — the percentile normalizer rescales library-relative anyway.
const BRIGHTNESS_CEILING_HZ = 4000

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

/**
 * Analyzes raw mono 44.1 kHz PCM and returns raw BPM / energy / mood measurements.
 */
export async function analyzePCM(
  id: string,
  data: Float32Array,
  sampleRate: number,
): Promise<TrackFeatures> {
  const essentia = await getEssentia()
  const signal = essentia.arrayToVector(data)
  try {
    // ── BPM + confidence ────────────────────────────────────────
    const rhythm = essentia.RhythmExtractor2013(signal, 208, 'multifeature', 40)
    rhythm.ticks.delete()
    rhythm.estimates.delete()
    rhythm.bpmIntervals.delete()
    const bpm = Math.round(Math.min(200, Math.max(50, rhythm.bpm)))
    const bpmConfidence = clamp01(rhythm.confidence / CONFIDENCE_MAX)

    // ── Energy (perceptual loudness) ────────────────────────────
    const energyRaw = essentia.Loudness(signal).loudness

    // ── Mood (brightness × mode blend, 0–1) ─────────────────────
    const { scale, strength } = essentia.KeyExtractor(signal)
    const modeScore = clamp01(scale === 'major' ? 0.5 + 0.5 * strength : 0.5 - 0.5 * strength)
    const centroidHz = essentia.SpectralCentroidTime(signal, sampleRate).centroid
    const brightness = clamp01(centroidHz / BRIGHTNESS_CEILING_HZ)
    const moodRaw = 0.6 * brightness + 0.4 * modeScore

    return { id, bpm, bpmConfidence, energyRaw, moodRaw, analyzedAt: Date.now() }
  } finally {
    signal.delete()
  }
}
