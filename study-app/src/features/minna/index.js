// みんなの日本語 DASHBOARD — package orchestrator + barrel. Owns the lifecycle (initMinna) and
// re-exports the public API main.js + cloud.js consume. Each concern lives in its own sibling module
// behind this barrel; shared mutable view-state is the `S` object in ./state.js (mutated in place —
// the record-compare/songs/selftalk pattern). features/minna.js is a thin re-export of this file, so
// main.js + cloud.js import unchanged. The modules form runtime-only import cycles (view⇄clips,
// view⇄speaking re-import renderMinnaLesson), fine like cloud⇄minna.
//
// Vocab "activation" REUSES the custom-card system: each word becomes a tagged custom card (or, if it
// matches a built-in, a provenance OVERLAY), so it joins the deck/SRS/Browse/Stats and syncs under
// the existing 'custom-verbs' blob. The only NEW synced blob is per-lesson NOTES + the overlays/clips
// (app key 'minna'). Content is fetched at runtime from /v1/minna/* (signed-in only) so the
// copyrighted textbook material never ships to anonymous visitors.
import { state } from '../../state.js';
import { loadMinnaStore } from './store.js';
import { handleBrowserTabHidden } from './speaking.js';

// Load the Minna store from localStorage. Called at boot AFTER the first custom-card rebuildData (so
// that rebuild sees the state.js default empty overlays — preserving the original order; the boot's
// migrateMinnaDupes + rebuildData then apply the real overlays).
export function initMinna() {
  state.minnaStore = loadMinnaStore();
  // One global listener (no-op unless speaking mode is on) — release the mic on browser-tab hide.
  document.addEventListener('visibilitychange', handleBrowserTabHidden);
}

// ---- public API (the names main.js + cloud.js import via the features/minna.js re-export) ----
export { renderMinna } from './view.js';
export { onMinnaHidden } from './speaking.js';
export { migrateMinnaDupes } from './activate.js';
export { minnaBlob, pullMinnaCloud, getLineClip, setLineClip } from './store.js';
