// Grammar-point registry — the id→{label,jlpt} catalog GENERATED offline from sentence-nlp/patterns.py
// (the SAME catalog whose detectors write sentence_tag(kind='grammar')), committed as grammar.json so
// the client's filter labels are one vocabulary with the auto-detected tags and can't drift.
// Regenerate after any CATALOG change: `python3 patterns.py` (no venv needed). Used by the Browse
// grammar filter (commit 3c) AND by data/selftalk.js (its SELFTALK_GRAMMAR derives labels from here).
import CATALOG from './grammar.json';

export const GRAMMAR_CATALOG = CATALOG; // [{id,label,jlpt}] in catalog (display) order

const LABEL = Object.fromEntries(CATALOG.map((g) => [g.id, g.label]));
const JLPT = Object.fromEntries(CATALOG.map((g) => [g.id, g.jlpt]));
const CAT_ORDER = new Map(CATALOG.map((g, i) => [g.id, i]));
const JLPT_RANK = { N5: 0, N4: 1, N3: 2, N2: 3, N1: 4 };

// Human label / JLPT for a grammar id; both fall back gracefully for an unknown id (e.g. a future
// tag the committed catalog hasn't learned yet) so the filter never shows a blank chip.
export function grammarLabel(id) { return LABEL[id] || id; }
export function grammarJlpt(id) { return JLPT[id] || ''; }

// Order a set of present grammar ids N5-first, then by catalog order within a level — the learner-
// friendly grouping for the filter chips. Pure (returns a new array).
export function orderGrammar(ids) {
  return [...ids].sort((a, b) => {
    const ja = JLPT_RANK[grammarJlpt(a)] ?? 9, jb = JLPT_RANK[grammarJlpt(b)] ?? 9;
    return ja !== jb ? ja - jb : (CAT_ORDER.get(a) ?? 1e9) - (CAT_ORDER.get(b) ?? 1e9);
  });
}
