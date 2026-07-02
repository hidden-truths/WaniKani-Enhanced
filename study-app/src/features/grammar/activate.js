// 合格 grammar → deck activation glue: one tap turns an N3 grammar point into a tagged
// custom card (cat:'grammar') drilled by the app's own SRS as a cloze. The card builder is
// pure core (buildGrammarCard); this module owns dedup + persistence, mirroring
// wanikani/activate.js: idempotent by grammarId (the songs/WK skip, NOT Minna overlays).
// The card is a display snapshot — explanation/formation/examples always render by
// grammarId lookup into the loaded catalog, so content fixes reach existing cards.
import { state } from '../../state.js';
import { buildGrammarCard, grammarDeckIndex, isDue } from '../../core/index.js';
import { loadCustom, saveCustom } from '../../persistence/custom.js';
import { rebuildData, refreshAfterVerbChange } from '../custom-cards.js';

// Activate: append tagged custom cards on monotonic seq ranks (never reused — SRS progress
// can't collide), save + rebuild once. Returns how many were actually added (already-in-deck
// points skip silently — re-clicking "Add all" is safe).
export function activateGrammarPoints(pointsToAdd) {
  const have = grammarDeckIndex(state.DATA);
  const adds = (pointsToAdd || []).filter((p) => p && p.id && !have.has(p.id));
  if (!adds.length) return 0;
  const cs = loadCustom();
  for (const p of adds) {
    cs.seq = (cs.seq || 100) + 1;
    cs.verbs.push(buildGrammarCard(p, cs.seq));
  }
  saveCustom(cs);
  rebuildData();
  refreshAfterVerbChange();
  return adds.length;
}

// How many grammar cards the deck holds + the due slice (the "Drill grammar" CTA copy).
export function grammarDeckCount() {
  let n = 0, due = 0;
  for (const v of state.DATA) if (v.grammar) { n++; if (isDue(v.rank)) due++; }
  return { n, due };
}
