// Shared mutable app state — the ONE place the cross-module deck/progress lives.
//
// Why an object and not `export let store`: the pure-core modules AND the test both
// read these, and the test REASSIGNS them (`state.store = {...}`). An importer can read
// a reassigned `export let` binding but can NEVER write it back (that's a SyntaxError),
// so a public object whose PROPERTIES are mutated is the one pattern that serves both.
// The feature modules set these at boot (loadStore / rebuildData); core/* read state.store etc.

import { VERBS, ACCENTS } from './data/verbs.js';
import { loadExampleCache } from './persistence/examples.js';

export const state = {
  // Progress blob; replaced at boot from localStorage (see loadStore in persistence/store.js).
  store: { cards: {}, sessions: [], daily: {} },
  // The live deck (built-ins + Minna overlays + custom), rebuilt by rebuildData() in features/custom-cards.js.
  DATA: [],
  MAXRANK: 100,
  // みんなの日本語 dashboard scratchpad + the dedup overlays; replaced at boot.
  minnaStore: { notes: {}, lastLesson: null, overlays: {} },
  // 独り言 Self-Talk: user-authored phrases + the practice/streak signal; replaced at boot.
  selftalkStore: { phrases: [], practice: { lastDay: null, streak: 0, doneToday: [] } },
  // Built-in headword (jp) → rank, for Minna activation's dedup-onto-a-built-in path.
  BUILTIN_RANK_BY_JP: {},
  // Leveled vocab example sentences ({ [rank]: { N5:[jp,en], … } }), fetched from the server
  // sentence store (Phase 2) and read by attachLevels below. Hydrated synchronously from the
  // localStorage read-through cache so the first attachLevels() at boot already has examples;
  // features/examples.js initExamples() refreshes it from the store, then re-attaches + re-renders.
  exampleLevels: loadExampleCache(),
};

VERBS.filter(v => !v.skip).forEach(v => {
  if (!(v.jp in state.BUILTIN_RANK_BY_JP)) state.BUILTIN_RANK_BY_JP[v.jp] = v.rank;
});

// Attach leveled examples (state.exampleLevels[rank], from the sentence store) + pitch accent
// (ACCENTS[rank]) + a default `cat` onto every card in state.DATA. Built-ins index by rank; Minna
// custom cards carry their own embedded levels/accent (kept via the `|| v.levels` fallback, since
// they have no store card link). Runs after every deck rebuild AND after initExamples() refreshes
// the level set from the store.
export function attachLevels() {
  state.DATA.forEach(v => {
    v.levels = state.exampleLevels[v.rank] || v.levels || null;
    if (v.accent == null && ACCENTS[v.rank] != null) v.accent = ACCENTS[v.rank];
    if (!v.cat) v.cat = 'verb';
  });
}
