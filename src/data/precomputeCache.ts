/**
 * Persistent key→value cache (IndexedDB) for compute-heavy library artifacts —
 * similarity-map layouts and PMI shape points. These survive across sessions so
 * a library only pays the expensive fingerprint / 3D-conformer cost once; the
 * launch screen reuses whatever is already stored.
 *
 * Values are plain JSON-serializable objects. Keys are namespaced and carry a
 * format version so a shape change transparently invalidates old entries.
 */

const DB_NAME = 'chemviewer-precompute';
const STORE = 'kv';
// Bump when the stored artifact shape changes, to invalidate stale entries.
export const CACHE_VERSION = 1;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

/** Read a cached value, or null if absent / unavailable. */
export async function pcGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Store a value; silently no-ops if IndexedDB is unavailable / quota-full. */
export async function pcSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** True if a key is present (used to gauge precompute progress on launch). */
export async function pcHas(key: string): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getKey(key);
      req.onsuccess = () => resolve(req.result !== undefined);
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/** Delete every cached artifact (Settings → clear precompute cache). */
export async function pcClear(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
