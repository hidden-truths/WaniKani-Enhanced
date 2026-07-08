// The custom-card APPEND protocol, shared by the four vocab→deck activation paths
// (jlpt/activate.js, wanikani/activate.js, grammar/activate.js, songs/progress.js).
// Each of them used to hand-copy the same five steps — loadCustom → bump cs.seq → push a
// built card → saveCustom → rebuildData → refreshAfterVerbChange — and every one of those
// steps fails SILENTLY when omitted (no type checker catches a missing rebuildData). This is
// the one place they live, so the class of bug is structurally impossible.
//
// Two collaborators stay OPAQUE to keep the four paths' load-bearing differences intact:
//   • dedupe(item) → true to SKIP. A closure, never a config enum — the predicates are
//     deliberately different (JLPT tests jp AND read, WK indexes jp only, grammar keys on the
//     point id, songs keys on the (song,lemma) songKey) and unifying them would silently give
//     one path another's semantics. It may mutate its own captured set so intra-batch dups skip.
//   • build(item, rank, today) → the pure core card builder. The helper reads `today` ONCE per
//     batch (the wk-activation-day-stamp fix, generalized) and hands it over; whether a field is
//     stamped is the BUILDER's call — grammar's builder ignores `today` on purpose, because a
//     grammar card must not carry `added` (weeklyAddPace skips v.grammar; a stamp would inflate
//     the 語 word quota). The helper itself NEVER writes a card field.
//
// `rank` (always (cs.seq||100)+1) and the source `tag` are NOT parameters: rank has zero
// per-site variation and exposing it invites violating the never-reuse invariant, and tags are
// built inside the pure, unit-tested core builders. LEAVE minna/activate.js ALONE — it is a
// planner/replayer over five op kinds with card removal + in-place update, not a filter-append.
import { localDay } from '../config.js';
import { loadCustom, saveCustom } from '../persistence/custom.js';
import { rebuildData, refreshAfterVerbChange } from './custom-cards.js';

// Append the non-duplicate `items` as custom cards on monotonic seq ranks, then save + rebuild
// ONCE (only when something was actually added — a re-click that dedupes to nothing is a no-op,
// no push, no rebuild). Returns how many cards were added.
export function appendCustomCards(items, dedupe, build) {
  const list = items || [];
  if (!list.length) return 0;
  const cs = loadCustom();
  const today = localDay();
  let added = 0;
  for (const item of list) {
    if (dedupe(item)) continue;
    cs.seq = (cs.seq || 100) + 1;
    cs.verbs.push(build(item, cs.seq, today));
    added++;
  }
  if (added) { saveCustom(cs); rebuildData(); refreshAfterVerbChange(); }
  return added;
}
