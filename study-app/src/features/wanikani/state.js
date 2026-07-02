// Shared mutable view-state for the 鰐蟹 WaniKani tab (the songs/minna `S` pattern —
// one plain object, properties mutated in place). The synced token lives in
// state.wanikaniStore (store.js); THIS is the in-memory session state: the loaded
// dataset (Maps for O(1) subject/assignment/stat lookups), sync status, and the
// view cursor (dashboard / leeches / browse + filters + the open detail subject).
export const S = {
  // dataset (from the IndexedDB cache via sync.js loadWkCache/syncWk)
  loaded: false,          // cache read into memory
  user: null,             // WK /user data (username, level, subscription)
  summary: null,          // { lessons, nextReviewsAt }
  subjects: new Map(),    // id → slim subject
  assignments: new Map(), // SUBJECT id → slim assignment (1:1)
  stats: new Map(),       // SUBJECT id → slim review_statistic (1:1)
  progressions: [],       // slim level_progressions
  lastSyncAt: null,

  // sync machinery
  syncing: false,
  syncMsg: '',
  syncErr: '',

  // token gate
  verifying: false,
  gateErr: '',

  // view cursor
  view: 'dashboard',      // 'dashboard' | 'leeches' | 'browse'
  forecastMode: '24h',    // '24h' | '7d'
  browse: { level: null, types: [], bands: [], q: '' },   // level null = user's current level
  browseCap: 400,         // grid render cap (bumped by "show more")
  detailId: null,         // open subject in the detail modal
  detailStack: [],        // breadcrumb of subject ids for in-modal navigation
};

// Adopt a loaded cache bundle (from loadWkCache/syncWk) into the Maps.
export function adoptWkData(bundle) {
  S.user = bundle.user;
  S.summary = bundle.summary;
  S.subjects = new Map(bundle.subjects.map((s) => [s.id, s]));
  S.assignments = new Map(bundle.assignments.map((a) => [a.subjectId, a]));
  S.stats = new Map(bundle.stats.map((st) => [st.subjectId, st]));
  S.progressions = bundle.progressions;
  S.lastSyncAt = bundle.lastSyncAt;
  S.loaded = true;
}

// Drop everything in-memory (disconnect). The IDB wipe is the caller's job.
export function resetWkData() {
  Object.assign(S, {
    loaded: false, user: null, summary: null, progressions: [], lastSyncAt: null,
    syncing: false, syncMsg: '', syncErr: '', verifying: false, gateErr: '',
    view: 'dashboard', detailId: null, detailStack: [], browseCap: 400,
    browse: { level: null, types: [], bands: [], q: '' },
  });
  S.subjects = new Map(); S.assignments = new Map(); S.stats = new Map();
}
