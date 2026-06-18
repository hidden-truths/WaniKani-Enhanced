// Shared mutable view-state for the 歌/Songs package. ES imports are read-only, so the modules that
// make up the tab (library/add/read/listen/shadow/mine/progress + the index orchestrator) share ONE
// object mutated IN PLACE (the study-app state.js pattern, cf. record-compare/state.js) — a reassigned
// module-`let` can't be split across files and mutated. The consts + body() live here too because
// more than one module reads them. Fields are only ever assigned as `S.x = …` (never `S = …`).

export const S = {
  loaded: false, // first paint done (renderSongs' optimistic-from-cache gate)
  library: [], // [{id,title,artist,youtubeId,source,custom,lineCount,timedCount,words}]
  libFilter: 'all', // 'all' | 'mine' | 'starter'
  view: 'library', // 'library' | 'add' | 'song'
  openSong: null, // the assembled song {id,title,…,lines} when viewing one
  mode: 'read', // 'read' | 'listen' | 'shadow' | 'mine' | 'grammar'
  videoOn: false, // Read mode: the video bay is hidden until "Play with video" (mock) — Listen/Shadow mount it regardless
  grammarRef: null, // the grammar id currently open in the reference panel
  add: { lyrics: '', url: '', title: '', artist: '', analysis: null, busy: false, error: '' },
  // Listen (dictation) per-song stepper; (re)initialized by ensureListen() when the song changes.
  // idx = current line; diff = cloze|full; done = line indices answered all-correct (correct =
  // done.size, so re-checking / stepping back never double-counts); checked/revealed/inputs = the step.
  listen: null,
  recordingsLoaded: false, // whether this session has fetched the SONGS_SCOPE take cache
};

const CACHE_KEY = 'jpverbs_songs_cache';
const LV_CLASS = { N5: 'lv-n5', N4: 'lv-n4', N3: 'lv-n3', N2: 'lv-n2', N1: 'lv-n1' };
const SLOW_RATE = 0.6; // slow-replay rate for the timed YouTube slice (the Listen "Slower" cue)
// Shadow (record & compare). Reserved recordings partition (the engine's `scope` → the server's
// opaque numeric `lesson` param); Minna uses 1–50, Self-Talk 90000, so 80000 never collides. One
// scope holds every song's takes — the itemKey ("<extId>:<ordinal>", songLineKey) carries song+line.
const SONGS_SCOPE = 80000;

export { CACHE_KEY, LV_CLASS, SLOW_RATE, SONGS_SCOPE };

// The Songs tab's stable render host (#sgBody) — the once-wired delegated-event target + render sink.
export function body() { return document.getElementById('sgBody'); }
