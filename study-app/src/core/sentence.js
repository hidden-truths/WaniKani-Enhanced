// Shared decoders for a server sentence row (GET /v1/sentences) → client model. The unified
// sentence store's wire shape is read in TWO places — the leveled-example adapter
// (core/examples.js sentencesToLevels) and the Self-Talk phrase adapter (core/selftalk.js
// sentenceToPhrase) — which independently re-spelled the SAME per-field rules (grammar-tag
// normalization, annotation-token extraction, the en-translation fallback). These primitives are
// the ONE source for those rules so the two adapters can't drift when the wire shape changes
// (e.g. an annotation schema bump, grammar becoming always-array server-side, a new translation
// lang). DOM-free + pure, so the test imports them directly. Each adapter still owns its own
// OUTPUT shape (levels-by-rank/tier vs the phrase object); only the field-reading is shared.

// Grammar tag ids from a sentence's `tags`. The store may send a single tag (scalar) or an array;
// absent → []. Always returns an array so callers don't each re-handle the scalar/array/missing
// cases (examples nested this under `meta.grammar`, Self-Talk returned it top-level — same rule,
// two spellings, now one).
export function sentenceGrammar(tags) {
  const g = tags && tags.grammar;
  return Array.isArray(g) ? g : g ? [g] : [];
}

// The GiNZA token array for a sentence — present only when fetched with `?annotate=1`, and absent
// on user-authored rows the offline NLP batch never parsed. Returns the array or null (the tap
// overlay falls back to plain ruby on null).
export function sentenceTokens(s) {
  return s && s.annotation && Array.isArray(s.annotation.tokens) ? s.annotation.tokens : null;
}

// The English translation with the store's nesting + the empty-string fallback both adapters used.
export function sentenceEn(s) {
  return (s && s.translations && s.translations.en) || '';
}
