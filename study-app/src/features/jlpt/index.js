// 合格 JLPT tab — lifecycle + public-API barrel (the wanikani package shape).
// main.js calls initJlpt() at boot and showJlpt() on tab activation; cloud.js registers
// jlptBlob (re-exported here) in the synced-blob registry.
//
// Data flow on tab open: render instantly from the local stores (deck/SRS/streaks are
// always in memory), then two async freshens re-render as they land — the JLPT word
// list chunk (ensureJlptReady, ~ms after first load) and the WaniKani dataset
// (ensureWkData → onWkData), so the readiness cards fill in without blocking paint.
import { loadJlpt } from './store.js';
import { ensureJlptReady, jlptMap } from './data.js';
import { renderJlpt, wireJlpt } from './view.js';
import { panelActive } from './state.js';
import { ensureWkData, onWkData } from '../wanikani/index.js';
import { updateDueBanner } from '../deck.js';

export { jlptBlob, saveJlpt, loadJlpt } from './store.js';
export { renderJlpt } from './view.js';
export { ensureJlptReady, jlptOf, jlptMap } from './data.js';

export function initJlpt() {
  loadJlpt();
  wireJlpt();
  updateDueBanner();   // the study-hero JLPT pill reads the just-loaded examDate (boot ran it earlier with the bare default)
  // Kick the word-list chunk at boot (idle-ish): activation stamping + the flashcard-hero
  // countdown pill want it early, and the backfill pass patches pre-lens 鰐蟹 cards once.
  ensureJlptReady().then(() => { if (panelActive()) renderJlpt(); }).catch(() => {});
  // Fresh WK data landing (cache hydrate or a sync) refreshes the readiness cards live.
  onWkData(() => { if (panelActive()) renderJlpt(); });
}

// Tab activation: paint what we have, then freshen the two async sources.
export function showJlpt() {
  renderJlpt();
  if (!jlptMap()) ensureJlptReady().then(() => { if (panelActive()) renderJlpt(); }).catch(() => {});
  ensureWkData();
}
