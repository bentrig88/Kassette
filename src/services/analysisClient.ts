/**
 * Main-thread client for the analysis worker pool.
 *
 * Decoding stays on the main thread (native + async), then we resample the clip
 * to mono 44.1 kHz via OfflineAudioContext and transfer the raw PCM to a
 * worker, which runs the heavy DSP (Essentia.js WASM). 44100 Hz is required:
 * Essentia's RhythmExtractor2013 has no sampleRate parameter and assumes it.
 *
 * A small round-robin pool of workers is used so multiple clips can be DSP'd in
 * parallel. The global `pending` map is keyed by `reqId` (monotonically
 * increasing, unique across the pool) — each worker's onmessage handler looks up
 * the promise by that key, so responses route correctly regardless of which
 * worker handled the request.
 */
import type { TrackFeatures } from './featureCache'

const TARGET_RATE = 44100

interface WorkerResponse {
  reqId: number
  features?: TrackFeatures
  error?: string
}

// Global seq + pending map — reqIds are unique across all workers in the pool.
let seq = 0
const pending = new Map<number, { resolve: (f: TrackFeatures) => void; reject: (e: unknown) => void }>()

// Worker pool
const POOL_SIZE = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))
let workers: Worker[] | null = null
let rr = 0

function makeWorker(): Worker {
  const w = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const { reqId, features, error } = e.data
    const entry = pending.get(reqId)
    if (!entry) return
    pending.delete(reqId)
    if (features) entry.resolve(features)
    else entry.reject(new Error(error ?? 'analysis failed'))
  }
  w.onerror = (e) => {
    // A worker-level failure can't be tied to one request — fail them all.
    for (const { reject } of pending.values()) reject(e.error ?? new Error('analysis worker error'))
    pending.clear()
  }
  return w
}

function nextWorker(): Worker {
  if (!workers) workers = Array.from({ length: POOL_SIZE }, makeWorker)
  const w = workers[rr % workers.length]
  rr += 1
  return w
}

/** Resample a decoded buffer to mono TARGET_RATE PCM. */
async function toMonoPCM(buffer: AudioBuffer): Promise<Float32Array> {
  const length = Math.max(1, Math.ceil(buffer.duration * TARGET_RATE))
  const offline = new OfflineAudioContext(1, length, TARGET_RATE)
  const src = offline.createBufferSource()
  src.buffer = buffer
  src.connect(offline.destination)
  src.start()
  const rendered = await offline.startRendering()
  // .slice() detaches a standalone ArrayBuffer we can transfer without harming
  // the rendered AudioBuffer's internal storage.
  return rendered.getChannelData(0).slice()
}

/**
 * Resample `buffer` and run feature analysis in the worker pool. Rejects if the
 * worker reports an error (callers already skip failed tracks).
 */
export async function analyzeAudioBuffer(id: string, buffer: AudioBuffer): Promise<TrackFeatures> {
  const samples = await toMonoPCM(buffer)
  const reqId = ++seq
  return new Promise<TrackFeatures>((resolve, reject) => {
    pending.set(reqId, { resolve, reject })
    nextWorker().postMessage({ reqId, id, samples, sampleRate: TARGET_RATE }, [samples.buffer])
  })
}
