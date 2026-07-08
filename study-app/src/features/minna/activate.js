// Vocab → deck activation glue. The card/overlay BUILDERS + the activation PLANNER are pure and
// unit-tested in core/minna.js (buildMinnaCard / buildMinnaOverlay / minnaOverlaySig /
// planMinnaActivation); this module is the thin glue that reads the live stores (the preview count)
// and replays the planner's ops onto them (the apply), plus the one-time pre-dedup migration.
//
// Vocab "activation" REUSES the custom-card system: each word becomes a tagged custom card (or, if
// it matches a built-in, a provenance OVERLAY), so it joins the deck/SRS/Browse/Stats and syncs
// under the existing 'custom-verbs' blob; only the overlays + per-lesson notes are the 'minna' blob.
import { state } from '../../state.js';
import { localDay } from '../../config.js';
import { planMinnaActivation, minnaMutablePatch } from '../../core/index.js';
import { loadCustom, saveCustom } from '../../persistence/custom.js';
import { rebuildData, refreshAfterVerbChange } from '../custom-cards.js';
import { saveMinna } from './store.js';

// A word is in the deck if it's a custom card OR an overlay on a built-in.
export function minnaInDeck(key) {
  if (loadCustom().verbs.some(v => v.minnaKey === key)) return true;
  const ov = (state.minnaStore && state.minnaStore.overlays) || {};
  return Object.keys(ov).some(r => ov[r].minnaKey === key);
}
// Non-mutating preview of what "Add all vocab to deck" would do — the add/update/in-deck counts come
// straight off the pure planner, so the button's label can never disagree with what the apply does.
export function minnaActivationStatus(lesson, vocab) {
  const ov = (state.minnaStore && state.minnaStore.overlays) || {};
  return planMinnaActivation(lesson, vocab, loadCustom().verbs, ov).counts;
}
// Activate a lesson's vocab by replaying the planner's operations onto the custom-card store + the
// overlay map. Built-in matches REUSE the built-in via an overlay; new words become custom cards
// (rank assigned here, monotonically, so SRS progress can't collide); a stale custom card that now
// matches a built-in is dropped (dedup). Re-activation patches mutable content in place via
// minnaMutablePatch (preserving rank → progress). Saves + rebuilds only what actually changed.
// Newly-added cards carry today's `added` stamp (the pacing signal); a re-activated card keeps its
// original stamp — minnaMutablePatch doesn't carry `added`, so re-running a lesson can't re-date the
// words you added weeks ago. Built-in matches become OVERLAYS, not cards, so they carry no stamp and
// don't count as adds — a known word rejoining under a Minna tag isn't new vocabulary.
export function activateMinnaVocab(lesson, vocab) {
  const cs = loadCustom(); const ov = state.minnaStore.overlays = state.minnaStore.overlays || {};
  const { ops, counts } = planMinnaActivation(lesson, vocab, cs.verbs, ov, localDay());
  let custChanged = false, ovChanged = false;
  for (const op of ops) {
    switch (op.kind) {
      case 'overlay-add': ov[op.rank] = op.overlay; ovChanged = true; break;
      case 'overlay-update': ov[op.rank] = Object.assign({}, ov[op.rank], op.overlay); ovChanged = true; break;
      case 'card-remove': { const i = cs.verbs.findIndex(v => v.minnaKey === op.minnaKey); if (i >= 0) { cs.verbs.splice(i, 1); custChanged = true; } break; }
      case 'card-update': { const e = cs.verbs.find(v => v.minnaKey === op.minnaKey); if (e) { Object.assign(e, minnaMutablePatch(op.card)); custChanged = true; } break; }
      case 'card-add': cs.seq = (cs.seq || 100) + 1; op.card.rank = cs.seq; cs.verbs.push(op.card); custChanged = true; break;
    }
  }
  if (custChanged) saveCustom(cs);
  if (ovChanged) saveMinna();
  if (custChanged || ovChanged) { rebuildData(); refreshAfterVerbChange(); }
  return { added: counts.toAdd, updated: counts.toUpdate };
}
// One-time cleanup of pre-dedup duplicates → overlays. Idempotent; runs on boot + after a cloud
// pull, syncs only on change.
export function migrateMinnaDupes() {
  const cs = loadCustom(); const ov = state.minnaStore.overlays = state.minnaStore.overlays || {};
  let cChanged = false, oChanged = false;
  for (let i = cs.verbs.length - 1; i >= 0; i--) {
    const v = cs.verbs[i]; if (!v.minna) continue;
    const br = state.BUILTIN_RANK_BY_JP[v.jp]; if (!br) continue;
    if (!ov[br]) { ov[br] = { tags: [...(v.tags || [])], italki: !!v.italki, minnaLesson: v.minnaLesson, minnaKey: v.minnaKey }; if (v.accent != null) ov[br].accent = v.accent; oChanged = true; }
    cs.verbs.splice(i, 1); cChanged = true;
  }
  if (cChanged) saveCustom(cs);
  if (oChanged) saveMinna();
  return cChanged || oChanged;
}
