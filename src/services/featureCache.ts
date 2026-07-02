/**
 * IndexedDB cache for per-track audio features.
 * Tracks are analyzed once as they play and results are stored here permanently.
 */

export interface TrackFeatures {
  id: string
  bpm: number            // detected BPM (RhythmExtractor2013), clamped to 50–200
  bpmConfidence?: number // 0–1 (multifeature confidence / 5.32); persisted but not yet consumed
  energyRaw: number      // Essentia Loudness (energy^0.67) — normalized library-relative on read
  moodRaw: number        // 0–1 brightness (spectral centroid) + major/minor mode blend — normalized library-relative on read
  analyzedAt: number
}

const DB_NAME = 'kassette-features'
const STORE = 'tracks'
const VERSION = 7 // bumped: DSP migrated to Essentia.js (RhythmExtractor2013/KeyExtractor/Loudness) — re-analyze

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
