// 鰐蟹 WaniKani synced store — the SMALL cloud-synced blob (app key 'wanikani'):
// the user's WK API token, nothing else yet. The WK DATASET is deliberately NOT in
// here — it's a device-local IndexedDB cache (idb.js), re-syncable from
// api.wanikani.com at any time, and would blow the 1 MB progress-blob ceiling anyway.
//
// Off-bus like the Minna blob: saveWanikani() schedules wanikaniBlob directly (no
// sync-bus slot), and cloud.js lists the blob in its registry via the wanikani.js
// barrel. Settings-style concurrency: no merge() — a 409 is server-wins (a token is
// last-writer-wins by nature).
import { state } from '../../state.js';
import { createSyncedBlob } from '../synced-blob.js';
import { onWanikaniTokenPulled } from './index.js';

const KEY = 'jpverbs_wanikani';

export function emptyWanikani() { return { token: null }; }

// Normalize an arbitrary parsed blob (localStorage / cloud / legacy) into the store
// shape. Pure; tolerates junk.
export function normalizeWanikani(o) {
  const base = emptyWanikani();
  if (!o || typeof o !== 'object') return base;
  if (typeof o.token === 'string' && o.token.trim()) base.token = o.token.trim();
  return base;
}

// Hydrate state.wanikaniStore from localStorage. Call once at boot, before any reader.
export function loadWanikani() {
  let o = null;
  try { o = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  state.wanikaniStore = normalizeWanikani(o);
  return state.wanikaniStore;
}

// Persist to localStorage only (instant, offline/anon-safe). saveWanikani() additionally
// schedules the debounced cloud push when signed in.
export function saveWanikaniLocal() {
  try { localStorage.setItem(KEY, JSON.stringify(state.wanikaniStore)); } catch (e) {}
}
export function saveWanikani() {
  saveWanikaniLocal();
  wanikaniBlob.schedule();
}

export const wanikaniBlob = createSyncedBlob({
  appKey: 'wanikani',
  read: () => state.wanikaniStore,
  apply: (data) => {
    if (data && typeof data === 'object' && typeof data.token === 'string' && data.token) {
      state.wanikaniStore = normalizeWanikani(data);
      saveWanikaniLocal();   // mirror WITHOUT re-pushing
      return true;
    }
    return false;   // nothing usable → fall through to the fresh-account seed
  },
  afterPull: () => { onWanikaniTokenPulled(); },   // kick a load/render if the tab is waiting on a token
  shouldSeed: () => !!state.wanikaniStore.token,   // seed the cloud only once a token exists locally
});
