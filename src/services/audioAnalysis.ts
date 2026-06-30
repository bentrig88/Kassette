/**
 * Pure audio feature DSP. Operates on raw mono PCM (Float32Array) so it can run
 * inside a Web Worker, off the main thread. Returns RAW measurements; absolute
 * 0–100 scaling happens library-relative in featureNormalize.ts.
 *
 * bpm       — autocorrelation of an energy-envelope onset signal, folded 60–150
 * energyRaw — linear RMS of the whole clip (loudness/intensity proxy)
 * moodRaw   — 0–1 blend of brightness (spectral centroid) and musical mode
 *             (major → happier, minor → darker), the latter from an FFT chroma
 *             vector matched against Krumhansl–Schmuckler key profiles.
 */
import type { TrackFeatures } from './featureCache'

// Krumhansl–Schmuckler key profiles (index 0 = C). Used to estimate major vs minor.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

const FFT_SIZE = 2048
const FFT_HOP = 1024

/**
 * In-place iterative radix-2 FFT. `re`/`im` must have a power-of-two length.
 */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr
      const ti = im[i]; im[i] = im[j]; im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cwr = 1
      let cwi = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const xr = re[b] * cwr - im[b] * cwi
        const xi = re[b] * cwi + im[b] * cwr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
        const ncwr = cwr * wr - cwi * wi
        cwi = cwr * wi + cwi * wr
        cwr = ncwr
      }
    }
  }
}

/** Pearson correlation of a 12-bin chroma vector with a key profile rotated by `rot`. */
function keyCorrelation(chroma: number[], profile: number[], rot: number): number {
  let mc = 0
  let mp = 0
  for (let i = 0; i < 12; i++) { mc += chroma[i]; mp += profile[i] }
  mc /= 12; mp /= 12
  let num = 0
  let dc = 0
  let dp = 0
  for (let i = 0; i < 12; i++) {
    const c = chroma[i] - mc
    const p = profile[(i - rot + 12) % 12] - mp
    num += c * p
    dc += c * c
    dp += p * p
  }
  const den = Math.sqrt(dc * dp)
  return den === 0 ? 0 : num / den
}

/**
 * Spectral features over Hann-windowed FFT frames:
 *   - centroid: mean spectral centroid in Hz (brightness)
 *   - mode:     +1 (major) / -1 (minor) with a 0–1 confidence, via chroma + KS profiles
 */
function spectralFeatures(data: Float32Array, sampleRate: number): {
  centroid: number
  modeSign: number
  modeConfidence: number
} {
  const re = new Float32Array(FFT_SIZE)
  const im = new Float32Array(FFT_SIZE)

  const hann = new Float32Array(FFT_SIZE)
  for (let i = 0; i < FFT_SIZE; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1))

  // Precompute per-bin frequency and pitch class (chroma bin), once.
  const half = FFT_SIZE / 2
  const binFreq = new Float32Array(half)
  const binPitch = new Int8Array(half)
  for (let k = 0; k < half; k++) {
    const f = (k * sampleRate) / FFT_SIZE
    binFreq[k] = f
    // Fold audible fundamentals 27.5 Hz (A0) .. 5 kHz into 12 pitch classes
    binPitch[k] = f >= 27.5 && f <= 5000 ? ((Math.round(69 + 12 * Math.log2(f / 440)) % 12) + 12) % 12 : -1
  }

  const chroma = new Array(12).fill(0)
  let centroidSum = 0
  let frames = 0

  for (let start = 0; start + FFT_SIZE <= data.length; start += FFT_HOP) {
    for (let i = 0; i < FFT_SIZE; i++) { re[i] = data[start + i] * hann[i]; im[i] = 0 }
    fft(re, im)
    let num = 0
    let den = 0
    for (let k = 1; k < half; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k])
      num += binFreq[k] * mag
      den += mag
      const pc = binPitch[k]
      if (pc >= 0) chroma[pc] += mag
    }
    if (den > 0) { centroidSum += num / den; frames++ }
  }

  if (frames === 0) return { centroid: 0, modeSign: 1, modeConfidence: 0 }

  const centroid = centroidSum / frames

  let bestMajor = -Infinity
  let bestMinor = -Infinity
  for (let rot = 0; rot < 12; rot++) {
    const cMaj = keyCorrelation(chroma, MAJOR_PROFILE, rot)
    const cMin = keyCorrelation(chroma, MINOR_PROFILE, rot)
    if (cMaj > bestMajor) bestMajor = cMaj
    if (cMin > bestMinor) bestMinor = cMin
  }
  const modeSign = bestMajor >= bestMinor ? 1 : -1
  const modeConfidence = Math.min(1, Math.abs(bestMajor - bestMinor) * 2)

  return { centroid, modeSign, modeConfidence }
}

/**
 * Analyzes raw mono PCM and returns raw BPM / energy / mood measurements.
 */
export function analyzePCM(id: string, data: Float32Array, sampleRate: number): TrackFeatures {
  // ── Energy (raw linear RMS) ─────────────────────────────────
  let sumSq = 0
  for (let i = 0; i < data.length; i++) sumSq += data[i] * data[i]
  const energyRaw = Math.sqrt(sumSq / Math.max(1, data.length))

  // ── Mood (brightness × mode blend, 0–1) ─────────────────────
  const { centroid, modeSign, modeConfidence } = spectralFeatures(data, sampleRate)
  const brightness = Math.min(1, Math.max(0, centroid / 4000)) // 0 dark .. 1 bright
  const modeScore = 0.5 + 0.5 * modeSign * modeConfidence       // 0 minor .. 1 major
  const moodRaw = 0.6 * brightness + 0.4 * modeScore            // 0..1

  // ── BPM (autocorrelation of onset strength) ─────────────────
  // Correlate the onset envelope with itself at different lags — the dominant
  // lag is the beat period.
  const hopSize = Math.floor(sampleRate * 0.01)    // 10ms hop
  const frameSize = Math.floor(sampleRate * 0.023) // ~23ms frame
  const numFrames = Math.floor((data.length - frameSize) / hopSize)

  const env: number[] = []
  for (let f = 0; f < numFrames; f++) {
    const s = f * hopSize
    let e = 0
    for (let i = s; i < s + frameSize; i++) e += data[i] * data[i]
    env.push(Math.sqrt(e / frameSize))
  }

  // Onset strength: half-wave rectified first derivative
  const onset: number[] = [0]
  for (let i = 1; i < env.length; i++) onset.push(Math.max(0, env[i] - env[i - 1]))

  const framesPerSec = sampleRate / hopSize
  const lagMin = Math.round((framesPerSec * 60) / 200) // 200 BPM
  const lagMax = Math.round((framesPerSec * 60) / 50)  // 50 BPM

  let bestLag = lagMin
  let bestCorr = -1
  for (let lag = lagMin; lag <= Math.min(lagMax, onset.length - 1); lag++) {
    let corr = 0
    for (let i = 0; i < onset.length - lag; i++) corr += onset[i] * onset[i + lag]
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag }
  }

  let bpm = bestLag > 0 ? Math.round((framesPerSec * 60) / bestLag) : 120
  // Fold into natural range 60–150
  while (bpm > 150) bpm = Math.round(bpm / 2)
  while (bpm < 60) bpm = bpm * 2

  return { id, bpm, energyRaw, moodRaw, analyzedAt: Date.now() }
}
