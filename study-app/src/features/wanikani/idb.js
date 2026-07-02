// IndexedDB cache for the WaniKani dataset — the one store in the app that outgrows
// localStorage (9.4k slimmed subjects ≈ 10-15 MB; the 5 MB localStorage quota is a hard
// no). Everything else about the app's persistence conventions still holds: this is a
// device-local read-through CACHE of api.wanikani.com (re-syncable at any time), never
// the source of truth, and nothing here is cloud-synced (the token + prefs blob in
// store.js is). Tiny promise wrapper, no library.
//
// Stores: subjects / assignments / stats (keyPath 'id') + meta (key-value: user,
// summary, progressions, per-collection updated_after cursors, lastSyncAt).

const DB_NAME = 'jpverbs_wanikani';
const DB_VERSION = 1;
const ROW_STORES = ['subjects', 'assignments', 'stats'];

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ROW_STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onabort = tx.onerror = () => reject(tx.error);
});

// Upsert a batch of rows into one store (single transaction).
export async function idbPutAll(store, rows) {
  if (!rows.length) return;
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const row of rows) os.put(row);
  return done(tx);
}

export async function idbGetAll(store) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGetMeta(key) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction('meta').objectStore('meta').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbSetMeta(key, value) {
  const db = await open();
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put(value, key);
  return done(tx);
}

// Wipe the whole cache (disconnect / "clear WK data"). Keeps the DB itself.
export async function idbClearAll() {
  const db = await open();
  const tx = db.transaction([...ROW_STORES, 'meta'], 'readwrite');
  for (const name of [...ROW_STORES, 'meta']) tx.objectStore(name).clear();
  return done(tx);
}
