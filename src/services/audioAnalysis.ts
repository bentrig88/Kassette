/**
 * Audio feature extraction from Web Audio AnalyserNode data.
 *
 * Energy  — RMS of time-domain signal, averaged over the analysis window
 * Mood    — Spectral centroid (brighter spectrum = higher value = happier)
 * BPM     — Sub-bass (40–120 Hz) peak detection, inter-peak interval → BPM
 */

export interface AnalysisState {
  // Energy accumulation
  energySamples: number[]

  // Mood accumulation
  moodSamples: number[]

  // BPM detection
  subBassHistory: number[]
  peakTimestamps: number[]
  dynamicThreshold: number
  lastPeakTime: number
}

export function createAnalysisState(): AnalysisState {
  return {
    energySamples: [],
    moodSamples: [],
    subBassHistory: [],
    peakTimestamps: [],
    dynamicThreshold: 0,
    lastPeakTime: 0,
  }
}

/**
 * Feed one frame of analyser data into the state.
 * Call this every ~50ms while the track is playing.
 */
export function feedFrame(
  state: AnalysisState,
  analyser: AnalyserNode,
  now: number // performance.now()
): void {
  const fftSize = analyser.fftSize
  const sampleRate = analyser.context.sampleRate

  // Time-domain data for energy
  const timeData = new Float32Array(fftSize)
  analyser.getFloatTimeDomainData(timeData)

  // Frequency-domain data for mood + BPM
  const freqData = new Float32Array(analyser.frequencyBinCount)
  analyser.getFloatFrequencyData(freqData)

  // ── Energy (RMS) ────────────────────────────────────────────
  let rmsSum = 0
  for (let i = 0; i < timeData.length; i++) rmsSum += timeData[i] * timeData[i]
  state.energySamples.push(Math.sqrt(rmsSum / timeData.length))

  // ── Mood (spectral centroid) ─────────────────────────────────
  const nyquist = sampleRate / 2
  let weightedFreq = 0
  let totalMag = 0
  for (let i = 0; i < freqData.length; i++) {
    const mag = Math.pow(10, freqData[i] / 20) // dB → linear
    const freq = (i / freqData.length) * nyquist
    weightedFreq += freq * mag
    totalMag += mag
  }
  if (totalMag > 0) state.moodSamples.push(weightedFreq / totalMag)

  // ── BPM (sub-bass peak detection, 40–120 Hz) ─────────────────
  const binSize = nyquist / freqData.length
  const lowBin = Math.max(0, Math.floor(40 / binSize))
  const highBin = Math.min(freqData.length - 1, Math.floor(120 / binSize))
  let subBassEnergy = 0
  for (let i = lowBin; i <= highBin; i++) {
    subBassEnergy += Math.pow(10, freqData[i] / 20)
  }
  subBassEnergy /= highBin - lowBin + 1

  state.subBassHistory.push(subBassEnergy)
  if (state.subBassHistory.length > 20) state.subBassHistory.shift()

  // Dynamic threshold: mean of recent history
  const mean = state.subBassHistory.reduce((a, b) => a + b, 0) / state.subBassHistory.length
  state.dynamicThreshold = mean * 1.4

  // Peak detection with minimum 250ms gap between beats (max 240 BPM)
  if (
    subBassEnergy > state.dynamicThreshold &&
    now - state.lastPeakTime > 250 &&
    state.subBassHistory.length >= 5
  ) {
    if (state.lastPeakTime > 0) {
      state.peakTimestamps.push(now)
    } else {
      state.peakTimestamps.push(now)
    }
    state.lastPeakTime = now
  }

  // Keep only last 30 peaks
  if (state.peakTimestamps.length > 30) state.peakTimestamps.shift()
}

/**
 * Analyzes a decoded AudioBuffer (e.g. from a 30s preview clip) and returns
 * BPM, energy, and mood without requiring real-time playback.
 */
export function analyzeBuffer(
  id: string,
  buffer: AudioBuffer
): import('./featureCache').TrackFeatures {
  const data = buffer.getChannelData(0)
  const sampleRate = buffer.sampleRate

  // ── Energy (RMS) ────────────────────────────────────────────
  let sumSq = 0
  for (let i = 0; i < data.length; i++) sumSq += data[i] * data[i]
  const rms = Math.sqrt(sumSq / data.length)
  const energy = Math.min(100, Math.round((rms / 0.25) * 100))

  // ── Mood (zero-crossing rate as brightness proxy) ────────────
  // Low ZCR = bass-heavy/dark, high ZCR = bright/energetic
  let zeroCrossings = 0
  for (let i = 1; i < data.length; i++) {
    if ((data[i] >= 0) !== (data[i - 1] >= 0)) zeroCrossings++
  }
  const zcr = (zeroCrossings / data.length) * sampleRate
  // Typical music range: 50 Hz (dark) → 3000 Hz (bright)
  const mood = Math.min(100, Math.max(0, Math.round(((zcr - 50) / 2950) * 100)))

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

  return { id, bpm, energy, mood, analyzedAt: Date.now() }
}

/**
 * Returns finalized features once enough data has been collected.
 * Returns null if not enough data yet.
 */
export function computeFeatures(
  id: string,
  state: AnalysisState
): { bpm: number; energy: number; mood: number } | null {
  // Need at least 10 peaks for BPM and 100 energy samples (~5s)
  if (state.peakTimestamps.length < 10 || state.energySamples.length < 100) {
    return null
  }

  // BPM from median inter-peak interval
  const intervals: number[] = []
  for (let i = 1; i < state.peakTimestamps.length; i++) {
    intervals.push(state.peakTimestamps[i] - state.peakTimestamps[i - 1])
  }
  intervals.sort((a, b) => a - b)
  const medianInterval = intervals[Math.floor(intervals.length / 2)]
  let bpm = Math.round(60000 / medianInterval)

  // Fold into natural range 60–150 to avoid doubling/halving artefacts
  while (bpm > 150) bpm = Math.round(bpm / 2)
  while (bpm < 60) bpm = bpm * 2

  // Energy: mean RMS normalized to 0–100
  // Typical RMS values for music: 0.01 (quiet) to 0.3 (loud)
  const meanRMS = state.energySamples.reduce((a, b) => a + b, 0) / state.energySamples.length
  const energy = Math.min(100, Math.round((meanRMS / 0.25) * 100))

  // Mood: spectral centroid normalized to 0–100
  // Typical centroid: 500 Hz (dark) to 4000 Hz (bright)
  const meanCentroid = state.moodSamples.reduce((a, b) => a + b, 0) / state.moodSamples.length
  const mood = Math.min(100, Math.max(0, Math.round(((meanCentroid - 500) / 3500) * 100)))

  return { bpm: Math.max(40, Math.min(220, bpm)), energy, mood }
}
