/**
 * IndexedDB cache for per-track audio features.
 * Tracks are analyzed once as they play and results are stored here permanently.
 */

export interface TrackFeatures {
  id: string
  bpm: number               // RhythmExtractor2013, clamped 50–200
  bpmConfidence?: number    // 0–1 (multifeature only; omitted for degara)
  loudness: number          // Loudness (Steven's-law energy^0.67)
  onsetRate: number         // OnsetRate — onsets per second (activity)
  dynamicComplexity: number // DynamicComplexity — loudness fluctuation
  centroidHz: number        // SpectralCentroidTime — brightness
  modeScore: number         // 0–1: major → 0.5+0.5·strength, minor → 0.5−0.5·strength
  danceability: number      // Danceability — groove/pulse strength
  analyzedAt: number
  // Tombstone: the track can NEVER be analyzed (no catalog entry / no preview
  // clip). Cached so it is excluded from analysis retries, normalizer
  // distributions, sort scoring, and "N/M analyzed" denominators. The numeric
  // fields are zeroed sentinels — always check this flag before reading them.
  unanalyzable?: true
}

/** Cache entry marking a track as permanently unanalyzable (no preview). */
export function makeTombstone(id: string): TrackFeatures {
  return {
    id, bpm: 0, loudness: 0, onsetRate: 0, dynamicComplexity: 0,
    centroidHz: 0, modeScore: 0, danceability: 0,
    analyzedAt: Date.now(), unanalyzable: true,
  }
}

const DB_NAME = 'kassette-features'
const STORE = 'tracks'
const VERSION = 8 // bumped: component-based features (loudness/onsetRate/dynamicComplexity/centroidHz/modeScore/danceability) — re-analyze

let _dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE)
      db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => { _dbPromise = null; reject(req.error) }
  })
  return _dbPromise
}

export async function getFeatures(id: string): Promise<TrackFeatures | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(id)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function setFeatures(features: TrackFeatures): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(features)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getAllFeatures(): Promise<Map<string, TrackFeatures>> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => {
      const map = new Map<string, TrackFeatures>()
      for (const f of req.result) map.set(f.id, f)
      resolve(map)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function getAllKeys(): Promise<Set<string>> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAllKeys()
    req.onsuccess = () => resolve(new Set(req.result as string[]))
    req.onerror = () => reject(req.error)
  })
}
