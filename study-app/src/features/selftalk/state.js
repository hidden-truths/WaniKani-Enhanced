// Shared mutable view-state for the 独り言 Self-Talk package. ES imports are read-only, so the
// modules that make up the tab (store/view/practice/authoring/speaking + the index orchestrator)
// share ONE object mutated IN PLACE (the study-app state.js pattern, cf. songs/state.js +
// record-compare/state.js) — a reassigned module-`let` can't be split across files and mutated.
// Fields are only ever assigned as `S.x = …` (never `S = …`). The consts + element accessors live
// here too because more than one module reads them.
//
// Note: persisted/synced Self-Talk state (the practice/streak signal) lives in state.selftalkStore
// (the global hub), NOT here — `S` is only the view-only + session-scoped working set.

export const S = {
  stGrammar: [],            // selected grammar tokens; empty = all
  stTopic: null,            // null = grid; topic id / TODAY_TOPIC = drilled-in topic view
  tplPicks: {},             // templateId → { slotId: fillerIndex } (current slot-swap selection)
  lpFired: false,           // a long-press just opened a slot menu → suppress the ensuing cycle-click
  recordingsLoaded: false,  // whether the take cache has been fetched this session
  storePhrases: [],         // the live phrase set (built-ins + own), from the fetch or the cache
  storeTemplates: [],       // the live slot-swap template set, from the fetch or the cache
  materializedCombos: new Set(), // template combos POSTed to /realize this session (per-session dedup)
  editingId: null,          // the phrase id open in the authoring modal (null = adding a new one)
};

export const TODAY_N = 8;            // how many phrases land in the rotating "Today's focus"
export const TODAY_TOPIC = '__today__';
// Reserved recordings partition (the engine's `scope` → the server's opaque numeric `lesson` param).
// Minna uses lesson numbers 1–50; this sits far above them so they never collide. Don't reuse 90000
// for a Minna lesson.
export const SELFTALK_SCOPE = 90000;

const REGISTER_LABELS = { plain: 'plain form', polite: 'です・ます', intimate: 'casual / intimate' };
export const registerLabel = (r) => REGISTER_LABELS[r] || r;

// The tab's stable render hosts (#stHead/#stBody) + a getElementById shorthand (the authoring-modal
// fields). #stBody is the attach-once record-compare container (drill-in swaps it in place).
export const elHead = () => document.getElementById('stHead');
export const elBody = () => document.getElementById('stBody');
export const $ = (id) => document.getElementById(id);
