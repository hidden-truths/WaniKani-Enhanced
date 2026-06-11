// Shared mutable app state — the ONE place the cross-module deck/progress lives.
//
// Why an object and not `export let store`: the pure-core modules AND the test both
// read these, and the test REASSIGNS them (`state.store = {...}`). An importer can read
// a reassigned `export let` binding but can NEVER write it back (that's a SyntaxError),
// so a public object whose PROPERTIES are mutated is the one pattern that serves both.
// app.js sets these at boot (loadStore / rebuildData); core/* read state.store etc.

import { VERBS, ACCENTS } from './data/verbs.js';
import { EXAMPLES } from './data/examples.js';

export const state = {
  // Progress blob; replaced at boot from localStorage (see loadStore in app.js).
  store: { cards: {}, sessions: [], daily: {} },
  // The live deck (built-ins + Minna overlays + custom), rebuilt by rebuildData() in app.js.
  DATA: [],
  MAXRANK: 100,
  // みんなの日本語 dashboard scratchpad + the dedup overlays; replaced at boot.
  minnaStore: { notes: {}, lastLesson: null, overlays: {} },
  // Built-in headword (jp) → rank, for Minna activation's dedup-onto-a-built-in path.
  BUILTIN_RANK_BY_JP: {},
};

VERBS.filter(v => !v.skip).forEach(v => {
  if (!(v.jp in state.BUILTIN_RANK_BY_JP)) state.BUILTIN_RANK_BY_JP[v.jp] = v.rank;
});

// Attach leveled examples (EXAMPLES[rank]) + pitch accent (ACCENTS[rank]) + a default
// `cat` onto every card in state.DATA. Built-ins index by rank; Minna custom cards carry
// their own embedded levels/accent (kept). Runs after every deck rebuild.
export function attachLevels() {
  state.DATA.forEach(v => {
    v.levels = EXAMPLES[v.rank] || v.levels || null;
    if (v.accent == null && ACCENTS[v.rank] != null) v.accent = ACCENTS[v.rank];
    if (!v.cat) v.cat = 'verb';
  });
}
