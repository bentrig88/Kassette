/**
 * Audio feature extraction from a decoded preview-clip AudioBuffer.
 *
 * Returns RAW measurements; absolute 0–100 scaling is NOT done here — it happens
 * library-relative in featureNormalize.ts so the sliders self-calibrate to the
 * user's own music.
 *
 * BPM       — autocorrelation of an onset-strength envelope, folded into 60–150
 * energyRaw — linear RMS of the whole clip (loudness/intensity proxy)
 * moodRaw   — zero-crossing rate in Hz (brightness proxy; higher = brighter)
 */

/**
 * Analyzes a decoded AudioBuffer (e.g. from a 30s preview clip) and returns
 * raw BPM / energy / mood measurements without requiring real-time playback.
 */
export function analyzeBuffer(
  id: string,
  buffer: AudioBuffer
): import('./featureCache').TrackFeatures {
  const data = buffer.getChannelData(0)
  const sampleRate = buffer.sampleRate

  // ── Energy (raw linear RMS) ─────────────────────────────────
  let sumSq = 0
  for (let i = 0; i < data.length; i++) sumSq += data[i] * data[i]
  const energyRaw = Math.sqrt(sumSq / data.length)

  // ── Mood (raw zero-crossing rate, Hz) ───────────────────────
  // Low ZCR = bass-heavy/dark, high ZCR = bright/energetic.
  let zeroCrossings = 0
  for (let i = 1; i < data.length; i++) {
    if ((data[i] >= 0) !== (data[i - 1] >= 0)) zeroCrossings++
  }
  const moodRaw = (zeroCrossings / data.length) * sampleRate

  // ── BPM (autocorrelation of onset strength) ─────────────────
  // Standard musicology approach: correlate the onset envelope with itself
  // at different lags — the dominant lag is the beat period.
  const hopSize = Math.floor(sampleRate * 0.01)    // 10ms hop
  const frameSize = Math.floor(sampleRate * 0.023) // ~23ms frame (~1024 samples @44.1kHz)
  const numFrames = Math.floor((data.length - frameSize) / hopSize)

  // Energy envelope
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

  // Autocorrelation over lags that correspond to 50–200 BPM
  const framesPerSec = sampleRate / hopSize
  const lagMin = Math.round(framesPerSec * 60 / 200) // 200 BPM
  const lagMax = Math.round(framesPerSec * 60 / 50)  // 50 BPM

  let bestLag = lagMin
  let bestCorr = -1
  for (let lag = lagMin; lag <= Math.min(lagMax, onset.length - 1); lag++) {
    let corr = 0
    for (let i = 0; i < onset.length - lag; i++) corr += onset[i] * onset[i + lag]
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag }
  }

  let bpm = Math.round((framesPerSec * 60) / bestLag)
  // Fold into natural range 60–150
  while (bpm > 150) bpm = Math.round(bpm / 2)
  while (bpm < 60) bpm = bpm * 2

  return { id, bpm, energyRaw, moodRaw, analyzedAt: Date.now() }
}
