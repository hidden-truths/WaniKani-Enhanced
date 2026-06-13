// Leveled-example selection — pure. Which JLPT tiers a card actually has a sentence for,
// and the [jp,en] pair for a requested tier with graceful fallback (exact → nearest →
// single `ex` → null). The data attach (v.levels = state.exampleLevels[rank]) lives in state.js;
// the level set is built from the sentence store by sentencesToLevels (below).

import { segmentsToRuby } from './text.js';

export const JLPT_TIERS = ['N5', 'N4', 'N3', 'N2', 'N1'];   // easy → hard

export function availableTiers(v) { return v.levels ? JLPT_TIERS.filter(t => v.levels[t]) : []; }

export function exampleForLevel(v, level) {
  const L = v.levels;
  if (L) {
    if (L[level]) return L[level];
    const i = JLPT_TIERS.indexOf(level);
    for (let d = 1; d < JLPT_TIERS.length; d++) {
      const lo = i - d >= 0 ? JLPT_TIERS[i - d] : null, hi = i + d < JLPT_TIERS.length ? JLPT_TIERS[i + d] : null;
      if (lo && L[lo]) return L[lo];
      if (hi && L[hi]) return L[hi];
    }
  }
  if (v.ex && v.ex.length) return v.ex[0];
  return null;
}

// Build the `v.levels` model — { [rank]: { N5:[jp,en,meta], …, N1:[jp,en,meta] } } — from a flat
// list of store sentences (GET /v1/sentences?ownerType=card). The store returns ONE entry per LINK,
// so a sentence reused across cards/tiers appears once per (owner_id, tier); we group by those. `jp`
// is reconstructed from the structured furigana (segmentsToRuby), `en` is translations.en — the
// original [jp, en] shape the old bundled EXAMPLES[rank][tier] carried, kept positional for
// back-compat. `meta` (3rd element, Phase-4 tap-to-lookup) carries the structured `furigana` segments
// + the GiNZA `tokens` (only when fetched with ?annotate=1) + the sentence's `grammar` ids; the
// overlay/grammar-filter read it and older code that only reads [0]/[1] is unaffected (and a stale
// cache lacking meta degrades to plain ruby). Pure (DOM-free), tested. Analogous to sentenceToPhrase.
// Entries missing owner_id/tier/furigana are skipped.
export function sentencesToLevels(sentences) {
  const out = {};
  for (const s of sentences || []) {
    const link = (s && s.link) || {};
    const rank = link.owner_id, tier = link.tier;
    if (rank == null || !tier || !Array.isArray(s.furigana)) continue;
    const en = (s.translations && s.translations.en) || '';
    const meta = { furigana: s.furigana };
    if (s.annotation && Array.isArray(s.annotation.tokens)) meta.tokens = s.annotation.tokens;
    const g = s.tags && s.tags.grammar;
    if (g) meta.grammar = Array.isArray(g) ? g : [g];
    (out[rank] ??= {})[tier] = [segmentsToRuby(s.furigana), en, meta];
  }
  return out;
}

// The distinct grammar ids across a card's example tiers (meta.grammar on each [jp,en,meta]). Powers
// the Browse grammar filter — a card "uses 〜ておく" iff one of its example sentences was tagged with
// it. Returns a Set (empty when no tier carries grammar, e.g. a pre-annotate cache). Pure.
export function cardGrammar(v) {
  const set = new Set();
  const L = v && v.levels;
  if (L) for (const tier of Object.keys(L)) {
    const meta = L[tier] && L[tier][2];
    if (meta && Array.isArray(meta.grammar)) for (const g of meta.grammar) set.add(g);
  }
  return set;
}

// True if the card has an example using ANY selected grammar id (OR within the facet). Empty/missing
// selection = no constraint (passes). Pure — the Browse grid ANDs this with passes(v, bcfg).
export function cardMatchesGrammar(v, selectedIds) {
  if (!selectedIds || !selectedIds.length) return true;
  const have = cardGrammar(v);
  return selectedIds.some((id) => have.has(id));
}
