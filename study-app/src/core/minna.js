// みんなの日本語 pure helpers: detect when a Minna word already exists as a built-in
// (dedup target), merge the provenance overlay onto the matching built-in (no duplicate
// card), and the content signature that drives the "Update N words" button. Read the
// shared state (BUILTIN_RANK_BY_JP, minnaStore); the activation UI glue lives in app.js.
import { state } from '../state.js';

// A Minna word maps onto a built-in verb iff its dictionary form is a built-in headword.
export function minnaBuiltinRank(item) {
  return state.BUILTIN_RANK_BY_JP[item.dict || item.kanji || item.kana] || null;
}

// Apply the Minna/iTalki provenance overlays onto the matching built-ins. Returns COPIES
// (not mutations of the shared VERBS objects) so removing an overlay reverts cleanly; a
// non-overlapped built-in is passed through by reference.
export function applyMinnaOverlays(builtins) {
  const ov = (state.minnaStore && state.minnaStore.overlays) || {};
  if (!Object.keys(ov).length) return builtins;
  return builtins.map(v => {
    const o = ov[v.rank]; if (!o) return v;
    const tags = [...(v.tags || [])]; (o.tags || []).forEach(t => { if (!tags.includes(t)) tags.push(t); });
    return Object.assign({}, v, { tags, minna: true, italki: !!o.italki, minnaKey: o.minnaKey, minnaLesson: o.minnaLesson },
      o.accent != null ? { accent: o.accent } : {}, o.tts ? { tts: o.tts } : {});
  });
}

// Signature of everything a re-activation can change — tags + iTalki flag AND the generated
// content (accent / mnemonic / tip / leveled examples). Including content is what lets
// "Update N words" appear when a card predates content added to the lesson.
export const minnaSig = v => (v.tags || []).join('|') + '·i' + (v.italki ? 1 : 0) + '·a' + (v.accent ?? '') + '·m' + (v.mnem || '') + '·t' + (v.tip || '') + '·L' + (v.levels ? JSON.stringify(v.levels) : '');
