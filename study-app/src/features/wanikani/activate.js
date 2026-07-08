// 鰐蟹 → deck activation glue (wk-leech-to-deck): one tap turns a WK vocabulary
// subject — a leech, or a whole same-kanji confusion family — into tagged custom
// cards (Source:鰐蟹) drilled by the app's own SRS, examples and record-compare.
// The card builder is pure core (buildWkCard); this module owns dedup + persistence,
// mirroring songs/progress.js activateSongWords: idempotent by wkId, and a word
// already in the deck under the same headword (built-in / みんなの日本語 / 歌) is
// skipped rather than duplicated — the songs-style skip, deliberately simpler than
// Minna's overlay path (see the ROADMAP wk-leech-to-deck record). The deck's Leitner
// takes over; the read-only WK SRS is never written back.
import { state } from '../../state.js';
import { localDay } from '../../config.js';
import { buildWkCard, primaryReading, isDue } from '../../core/index.js';
import { loadCustom, saveCustom } from '../../persistence/custom.js';
import { rebuildData, refreshAfterVerbChange } from '../custom-cards.js';
import { jlptOf } from '../jlpt/data.js';

// One pass over the live deck → the dedup index the views and the apply share
// (state.DATA already includes every custom card, so it covers wkId re-adds too).
export function wkDeckIndex() {
  const jp = new Set(), ids = new Set();
  for (const v of state.DATA) { if (v.jp) jp.add(v.jp); if (v.wkId) ids.add(v.wkId); }
  return { jp, ids };
}

export const wkInDeck = (s, idx) => {
  const d = idx || wkDeckIndex();
  return d.ids.has(s.id) || (!!s.chars && d.jp.has(s.chars));
};

// The subjects an activation would actually add: vocabulary (kanji/radicals aren't
// cards — a kanji leech is treated by drilling its vocab family), not already in the deck.
export function activatableWk(subjects, idx) {
  const d = idx || wkDeckIndex();
  return subjects.filter((s) => s && s.type === 'vocabulary' && !s.hidden && s.chars && !wkInDeck(s, d));
}

// Activate: append tagged custom cards on monotonic seq ranks (never reused — SRS
// progress can't collide), save + rebuild once. Each card is stamped with its JLPT
// level (jlptOf — the lazily-loaded list is kicked at boot by initJlpt, so it's
// loaded by any human-speed activation; '' when unknown, backfilled later by
// backfillWkJlpt if the chunk somehow wasn't). Returns how many were actually added.
export function activateWkVocab(subjects) {
  const adds = activatableWk(subjects);
  if (!adds.length) return 0;
  const cs = loadCustom();
  for (const s of adds) {
    cs.seq = (cs.seq || 100) + 1;
    cs.verbs.push(buildWkCard(s, cs.seq, jlptOf(s.chars, primaryReading(s)), localDay()));
  }
  saveCustom(cs);
  rebuildData();
  refreshAfterVerbChange();
  return adds.length;
}

// How many Source:鰐蟹 cards the deck currently holds (the "Study N now" CTA count),
// with the DUE slice broken out so the CTA can say what actually needs attention.
export function wkDeckCount() {
  let n = 0, due = 0;
  for (const v of state.DATA) if (v.wanikani) { n++; if (isDue(v.rank)) due++; }
  return { n, due };
}
