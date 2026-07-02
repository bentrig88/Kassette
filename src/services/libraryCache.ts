/**
 * IndexedDB snapshot of the fetched Apple Music library, so app startup can
 * render cassettes instantly and revalidate in the background instead of
 * refetching 50–150 paginated requests on every load.
 *
 * The snapshot stores both the mapped Track[] AND the raw MusicKit MediaItems
 * (plain JSON from the API) — the raw items carry the internal cloudId that
 * setQueue needs, so playback works straight from cache. Every write is
 * best-effort: any failure (quota, clone error) falls back to the network path.
 */
import type { Track } from '../types/music'

export interface LibrarySnapshot {
  id: 'snapshot'
  savedAt: number
  tracks: Track[]
  rawItems: [string, MusicKit.MediaItem][]
}

const DB_NAME = 'kassette-library'
const STORE = 'library'
const VERSION = 1

let _dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => { _dbPromise = null; reject(req.error) }
  })
  return _dbPromise
}

export async function loadLibrarySnapshot(): Promise<LibrarySnapshot | null> {
  try {
    const db = await openDB()
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get('snapshot')
      req.onsuccess = () => resolve((req.result as LibrarySnapshot | undefined) ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export async function saveLibrarySnapshot(tracks: Track[], rawItems: [string, MusicKit.MediaItem][]): Promise<void> {
  try {
    const db = await openDB()
    const snapshot: LibrarySnapshot = { id: 'snapshot', savedAt: Date.now(), tracks, rawItems }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(snapshot)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {/* best-effort — next load takes the network path */}
}

/** Drop the snapshot (sign-out: don't flash another account's library). */
export async function clearLibrarySnapshot(): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete('snapshot')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {/* best-effort */}
}
