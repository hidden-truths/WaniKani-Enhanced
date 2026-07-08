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
import { buildWkCard, primaryReading, deckSourceCount } from '../../core/index.js';
import { appendCustomCards } from '../append-cards.js';
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

// Is one subject addable as a card: vocabulary (kanji/radicals aren't cards — a kanji leech is
// treated by drilling its vocab family), not hidden, has chars, not already in the deck. Shared
// by the enumeration (activatableWk) and the activation dedup so the two can't drift.
const wkAddable = (s, d) => !!(s && s.type === 'vocabulary' && !s.hidden && s.chars && !wkInDeck(s, d));

// The subjects an activation would actually add.
export function activatableWk(subjects, idx) {
  const d = idx || wkDeckIndex();
  return subjects.filter((s) => wkAddable(s, d));
}

// Activate: append tagged custom cards on monotonic seq ranks (never reused — SRS
// progress can't collide), save + rebuild once (via the shared appendCustomCards protocol).
// Each card is stamped with its JLPT level (jlptOf — the lazily-loaded list is kicked at boot
// by initJlpt, so it's loaded by any human-speed activation; '' when unknown, backfilled later
// by backfillWkJlpt if the chunk somehow wasn't). Returns how many were actually added.
//
// The helper reads `today` ONCE for the batch (this is where the wk-activation-day-stamp fix
// now lives, shared by all four paths): a bulk activation — a whole confusion family, or every
// focus leech — that straddles local midnight would otherwise stamp one batch with two different
// `added` days, splitting it across two rows of the 語 quota. The day-stamp is the checklist
// row's live signal, so it has to agree with itself.
export function activateWkVocab(subjects) {
  const d = wkDeckIndex();
  return appendCustomCards(
    subjects,
    (s) => !wkAddable(s, d),
    (s, rank, today) => buildWkCard(s, rank, jlptOf(s.chars, primaryReading(s)), today),
  );
}

// How many Source:鰐蟹 cards the deck currently holds (the "Study N now" CTA count),
// with the DUE slice broken out so the CTA can say what actually needs attention.
export const wkDeckCount = () => deckSourceCount('wanikani');
