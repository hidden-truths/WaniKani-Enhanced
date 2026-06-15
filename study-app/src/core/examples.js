// Leveled-example selection — pure. Which JLPT tiers a card actually has a sentence for,
// and the [jp,en] pair for a requested tier with graceful fallback (exact → nearest →
// single `ex` → null). The data attach (v.levels = state.exampleLevels[rank]) lives in state.js;
// the level set is built from the sentence store by sentencesToLevels (below).

import { segmentsToRuby, isCleanRuby, plainText, rubyToSegments } from './text.js';
import { sentenceGrammar, sentenceTokens, sentenceEn } from './sentence.js';

export const JLPT_TIERS = ['N5', 'N4', 'N3', 'N2', 'N1'];   // easy → hard

// Build the PUT /v1/sentences/card/{rank} body from a custom card's example fields (Phase 2.5 —
// custom-card examples become PRIVATE store rows so they render from the store like built-ins). One
// slot per present example: 'ex' (the single untiered fallback) + each present JLPT `levels` tier.
// text = plainText(jp), furigana = the structured segments (concat(seg.t) === text, the server's
// write invariant), en = the pair's English. Pure — the dual-write mirrors exactly what the deck
// renders, so the row's text is the same /v1/audio/tts key.
export function cardExamplesPayload(verb) {
  const examples = [];
  const add = (slot, pair) => {
    const jp = pair && pair[0] ? String(pair[0]) : '';
    if (!jp) return;
    examples.push({ slot, text: plainText(jp), furigana: rubyToSegments(jp), en: pair && pair[1] ? String(pair[1]) : '' });
  };
  if (verb && verb.ex && verb.ex[0]) add('ex', verb.ex[0]);
  const L = verb && verb.levels;
  if (L) for (const tier of JLPT_TIERS) if (L[tier]) add(tier, L[tier]);
  return { examples };
}

// Build a custom card's `levels` from the Add-card leveled editor's raw per-tier [jp, en] inputs.
// Drops any tier whose JP is blank (partial sets are fine — exampleForLevel's nearest-tier fallback
// covers gaps), trims both halves, and validates each JP is clean ruby (innerHTML-rendered, so it
// must be — see isCleanRuby). Returns { levels, invalidTier }: `levels` is the object (null when no
// tier has JP, matching the "no levels" card shape), `invalidTier` names the first tier whose JP
// isn't clean ruby (caller surfaces the error + aborts) or null. Pure, tested.
export function buildLevels(pairs) {
  const out = {};
  for (const tier of JLPT_TIERS) {
    const pair = (pairs && pairs[tier]) || [];
    const jp = pair[0] ? String(pair[0]).trim() : '';
    if (!jp) continue;
    if (!isCleanRuby(jp)) return { levels: null, invalidTier: tier };
    out[tier] = [jp, pair[1] ? String(pair[1]).trim() : ''];
  }
  return { levels: Object.keys(out).length ? out : null, invalidTier: null };
}

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
    const meta = { furigana: s.furigana };
    const tokens = sentenceTokens(s);
    if (tokens) meta.tokens = tokens;
    const grammar = sentenceGrammar(s.tags);
    if (grammar.length) meta.grammar = grammar;
    (out[rank] ??= {})[tier] = [segmentsToRuby(s.furigana), sentenceEn(s), meta];
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
