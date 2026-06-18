// Persistence + cloud sync for the みんなの日本語 store, plus the conversation-line clip ranges. The
// store SHAPE lives in state.minnaStore (the global hub); this module owns the localStorage
// read/write, the 'minna' SyncedBlob (server-wins-on-login + fresh-account seed + 409 merge), and
// the clip getters/setters. saveMinna is the one write entry point (local write + debounced push).
import { state } from '../../state.js';
import { normalizeMinnaStore, mergeMinna } from '../../core/index.js';
import { createSyncedBlob } from '../synced-blob.js';
import { MINNA_APP_KEY, MINNA_KEY, MINNA_DEFAULT } from './state.js';

// Load the Minna store from localStorage, normalized onto the defaults (corrupt JSON degrades to a
// fresh store). Called at boot AFTER the first custom-card rebuildData (so that rebuild sees the
// default empty overlays; the boot's migrateMinnaDupes + rebuildData then apply the real overlays).
export function loadMinnaStore() {
  try { return normalizeMinnaStore(JSON.parse(localStorage.getItem(MINNA_KEY)), MINNA_DEFAULT); } catch (e) {}
  return normalizeMinnaStore(null, MINNA_DEFAULT);
}
function saveMinnaLocal() { try { localStorage.setItem(MINNA_KEY, JSON.stringify(state.minnaStore)); } catch (e) {} }

// --- Notes/overlays/clips sync — folded into the shared SyncedBlob abstraction (app key 'minna').
//     Same server-wins-on-login + fresh-account-seed model as the other blobs; cloud.js's pullCloud
//     calls minnaBlob.pull (re-exported as pullMinnaCloud) and registers it in the offline-queue map. ---
export const minnaBlob = createSyncedBlob({
  appKey: MINNA_APP_KEY,
  read: () => state.minnaStore,
  apply: (data) => {
    if (data && typeof data === 'object') {
      state.minnaStore = normalizeMinnaStore(data, MINNA_DEFAULT);
      saveMinnaLocal();
      return true;
    }
    return false;   // fall through to the fresh-account seed
  },
  shouldSeed: () => !!(Object.keys(state.minnaStore.notes || {}).length || Object.keys(state.minnaStore.overlays || {}).length || Object.keys(state.minnaStore.clips || {}).length),
  merge: mergeMinna,   // E1: union notes/overlays/clips on a 409 (local wins per key) instead of dropping local
});
export const pullMinnaCloud = minnaBlob.pull;

// The single write path: persist locally + schedule the debounced cloud push.
export function saveMinna() { saveMinnaLocal(); minnaBlob.schedule(); }

// Conversation-line clip ranges (per-user, synced). Read by the compare player to slice the whole-
// conversation MP3 to one line; written by the in-app clip marker.
export function getLineClip(lesson, idx) { const c = state.minnaStore.clips; return (c && c[lesson] && c[lesson][idx]) || null; }
export function setLineClip(lesson, idx, clip) {
  const clips = state.minnaStore.clips = state.minnaStore.clips || {};
  const forLesson = clips[lesson] = clips[lesson] || {};
  if (clip) forLesson[idx] = clip; else delete forLesson[idx];
  saveMinna();
}
