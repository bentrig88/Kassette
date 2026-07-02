/**
 * Dedicated worker: runs the CPU-bound audio DSP off the main thread.
 * Receives raw mono PCM (transferred), returns TrackFeatures via analysisClient.
 */
import { analyzePCM } from '../services/audioAnalysis'

interface AnalyzeRequest {
  reqId: number
  id: string
  samples: Float32Array
  sampleRate: number
}

// `self.postMessage` is typed for Window under the DOM lib; cast to the worker shape.
const post = (msg: unknown) => (self as unknown as { postMessage: (m: unknown) => void }).postMessage(msg)

self.onmessage = async (e: MessageEvent<AnalyzeRequest>) => {
  const { reqId, id, samples, sampleRate } = e.data
  try {
    const features = await analyzePCM(id, samples, sampleRate)
    post({ reqId, features })
  } catch (err) {
    post({ reqId, error: String(err) })
  }
}
