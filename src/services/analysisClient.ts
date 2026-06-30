/**
 * Main-thread client for the analysis worker.
 *
 * Decoding stays on the main thread (native + async), then we resample the clip
 * to mono 11.025 kHz via OfflineAudioContext and transfer the raw PCM to the
 * worker, which runs the heavy DSP. Downsampling cuts the sample count ~4× and
 * is plenty for BPM / energy / brightness / key estimation.
 */
import type { TrackFeatures } from './featureCache'

const TARGET_RATE = 11025

interface WorkerResponse {
  reqId: number
  features?: TrackFeatures
  error?: string
}

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (f: TrackFeatures) => void; reject: (e: unknown) => void }>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const { reqId, features, error } = e.data
      const entry = pending.get(reqId)
      if (!entry) return
      pending.delete(reqId)
      if (features) entry.resolve(features)
      else entry.reject(new Error(error ?? 'analysis failed'))
    }
    worker.onerror = (e) => {
      // A worker-level failure can't be tied to one request — fail them all.
      for (const { reject } of pending.values()) reject(e.error ?? new Error('analysis worker error'))
      pending.clear()
    }
  }
  return worker
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
 * Resample `buffer` and run feature analysis in the worker. Rejects if the
 * worker reports an error (callers already skip failed tracks).
 */
export async function analyzeAudioBuffer(id: string, buffer: AudioBuffer): Promise<TrackFeatures> {
  const samples = await toMonoPCM(buffer)
  const reqId = ++seq
  return new Promise<TrackFeatures>((resolve, reject) => {
    pending.set(reqId, { resolve, reject })
    getWorker().postMessage({ reqId, id, samples, sampleRate: TARGET_RATE }, [samples.buffer])
  })
}
