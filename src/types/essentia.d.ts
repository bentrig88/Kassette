/**
 * Ambient types for essentia.js 0.1.3 deep-dist imports (the package ships no
 * `types` entry). Only the algorithms Kassette uses are declared; shapes were
 * verified empirically against the installed version (see the Essentia
 * migration plan's spike findings).
 */
declare module 'essentia.js/dist/essentia.js-core.es.js' {
  /** Emscripten-bound C++ vector — must be freed with .delete(), not GC'd. */
  export interface EssentiaVector {
    delete(): void
  }

  export default class Essentia {
    constructor(wasm: unknown)
    version: string
    arrayToVector(arr: Float32Array): EssentiaVector
    RhythmExtractor2013(
      signal: EssentiaVector,
      maxTempo?: number,
      method?: 'multifeature' | 'degara',
      minTempo?: number,
    ): {
      bpm: number
      confidence: number
      ticks: EssentiaVector
      estimates: EssentiaVector
      bpmIntervals: EssentiaVector
    }
    Loudness(signal: EssentiaVector): { loudness: number }
    KeyExtractor(signal: EssentiaVector): { key: string; scale: 'major' | 'minor'; strength: number }
    SpectralCentroidTime(signal: EssentiaVector, sampleRate?: number): { centroid: number }
  }
}

declare module 'essentia.js/dist/essentia-wasm.es.js' {
  /** Emscripten Module object (base64-embedded WASM, sync-instantiated). */
  export const EssentiaWASM: unknown
}
