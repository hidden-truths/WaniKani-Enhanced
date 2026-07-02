// 鰐蟹 WaniKani tab — lifecycle + public-API barrel (the songs/minna package shape).
// main.js calls initWanikani() at boot and showWanikani() on tab activation; cloud.js
// registers wanikaniBlob (re-exported here) in the synced-blob registry.
//
// Data flow on tab open: token? → hydrate from the IndexedDB cache instantly →
// background incremental sync against api.wanikani.com → re-render. No token → the
// connect gate. The dataset lives in feature state S (state.js); only the token is
// cloud-synced (store.js).
import { state } from '../../state.js';
import { S, adoptWkData, resetWkData } from './state.js';
import { loadWanikani, saveWanikani } from './store.js';
import { loadWkCache, syncWk, verifyToken } from './sync.js';
import { idbClearAll } from './idb.js';
import { renderWanikani, renderWkStatus, wireWanikani, panelActive } from './view.js';

export { wanikaniBlob } from './store.js';
export { renderWanikani } from './view.js';

// Re-syncing more often than this on tab hops is just wasted requests — WK reviews
// unlock on the hour, so a 5-minute floor keeps us fresh without being chatty.
const SYNC_MIN_GAP_MS = 5 * 60e3;

export function initWanikani() {
  loadWanikani();
  wireWanikani();
}

// Tab activation: paint whatever we have, then freshen.
export function showWanikani() {
  renderWanikani();
  ensureWkData();
}

// Other surfaces (the JLPT tab's readiness/checklist) subscribe to dataset arrivals —
// fired whenever adoptWkData lands fresh data (cache hydrate + each completed sync).
const wkDataListeners = [];
export function onWkData(fn) { wkDataListeners.push(fn); }
const notifyWkData = () => { for (const fn of wkDataListeners) { try { fn(); } catch (e) {} } };

// Load the cached dataset into memory (instant) + kick a background freshen. Exported for
// the JLPT tab, which needs WK signals (reviews-now / leeches / N3 coverage) WITHOUT the
// user ever opening the 鰐蟹 tab. Safe no-op without a token.
export async function ensureWkData() {
  const token = state.wanikaniStore.token;
  if (!token) return;
  if (!S.loaded) {
    const cached = await loadWkCache().catch(() => null);
    if (cached) { adoptWkData(cached); if (panelActive()) renderWanikani(); notifyWkData(); }
  }
  maybeSyncWk(false);
}

// One sync at a time; `force` skips the freshness floor (the ↻ button).
export async function maybeSyncWk(force) {
  const token = state.wanikaniStore.token;
  if (!token || S.syncing) return;
  if (!force && S.lastSyncAt && Date.now() - S.lastSyncAt < SYNC_MIN_GAP_MS) return;
  S.syncing = true; S.syncErr = ''; S.syncMsg = S.loaded ? 'refreshing…' : 'first sync — fetching your WaniKani data…';
  if (S.loaded) renderWkStatus(); else renderWanikani();   // gate → full-screen progress; loaded → quiet status line
  try {
    const bundle = await syncWk(token, (msg) => { S.syncMsg = msg; renderWkStatus(); });
    adoptWkData(bundle);
    notifyWkData();
  } catch (e) {
    S.syncErr = e && e.code === 'unauthorized'
      ? 'WaniKani rejected the token — reconnect with a fresh one.'
      : 'Could not reach WaniKani — showing cached data.';
  }
  S.syncing = false; S.syncMsg = '';
  if (panelActive()) renderWanikani();
}

// The connect gate's submit: verify against /user before adopting the token, so a typo
// never gets persisted (or pushed to the cloud blob).
export async function connectWanikani(token) {
  S.verifying = true; S.gateErr = '';
  renderWanikani();
  try {
    await verifyToken(token);
    state.wanikaniStore.token = token;
    saveWanikani();
    S.verifying = false;
    renderWanikani();
    maybeSyncWk(true);
  } catch (e) {
    S.verifying = false;
    S.gateErr = e && e.code === 'unauthorized'
      ? 'WaniKani rejected that token. Check it and try again.'
      : 'Could not reach WaniKani. Check your connection and try again.';
    renderWanikani();
  }
}

// Disconnect: forget the token (locally + cloud blob) and wipe the device cache.
export async function disconnectWanikani() {
  state.wanikaniStore.token = null;
  saveWanikani();
  resetWkData();
  try { await idbClearAll(); } catch (e) {}
  renderWanikani();
}

// Cloud pull landed a token (sign-in on a new device): if the user is parked on the
// gate, connect through it without a paste. (The blob's apply() already mirrored the
// token to localStorage.)
export function onWanikaniTokenPulled() {
  if (!state.wanikaniStore.token) return;
  if (panelActive()) showWanikani();
}
