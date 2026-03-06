/**
 * IndexedDB cache for per-track audio features.
 * Tracks are analyzed once as they play and results are stored here permanently.
 */

export interface TrackFeatures {
  id: string
  bpm: number      // beats per minute (raw)
  energy: number   // 0–100
  mood: number     // 0–100 (0 = dark/sad, 100 = bright/happy)
  analyzedAt: number
}

const DB_NAME = 'kassette-features'
const STORE = 'tracks'
const VERSION = 3 // bumped to clear bad BPM values — now using autocorrelation

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE)
      db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
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
