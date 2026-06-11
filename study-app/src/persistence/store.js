// Progress STORAGE — all progress lives in ONE localStorage key as a single JSON blob
// (see the state.store shape in index.html's header). Persistence model:
//   • Mutations happen in memory on the state.store object.
//   • save() is called after every grade (so a tab-close mid-session doesn't lose
//     progress) and after import/reset.
// save() and the initial read are wrapped in try/catch because localStorage can throw
// (private mode, quota, disabled). Failure degrades to in-memory-only — the app still
// runs, it just won't persist.
//
// SCHEMA VERSIONING: the key is suffixed "_v3". If the state.store shape changes
// incompatibly, bump to _v4 and (ideally) write a migration that reads the old key.
// Right now we do soft per-field migration in cardStat() instead.
import { state } from '../state.js';
import { sync } from '../sync-bus.js';

const KEY = 'jpverbs_v3';

// Hydrate state.store from localStorage. Call once at boot, before any reader.
export function loadStore() {
  try { state.store = JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { state.store = null; }
  if (!state.store) state.store = { cards: {}, sessions: [], daily: {} };
  // Guards: tolerate older/partial saves missing a top-level collection.
  if (!state.store.cards) state.store.cards = {};
  if (!state.store.sessions) state.store.sessions = [];
  if (!state.store.daily) state.store.daily = {};
}

// saveLocal() persists to localStorage only (instant, offline-safe). save() additionally
// schedules a debounced cloud push when signed in (via the sync bus → cloud.js). Splitting
// them lets cloud-hydration write localStorage WITHOUT re-pushing the same bytes back.
export function saveLocal() {
  try { localStorage.setItem(KEY, JSON.stringify(state.store)); } catch (e) {}
}
export function save() {
  saveLocal();
  sync.progress();
}
