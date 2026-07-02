// N3 grammar catalog singleton — the lazy loader around the generated data/grammar-n3.js
// (dynamic import → its own Vite chunk, the data/jlpt.js pattern) + the store-served NLP
// layer (GiNZA tokens for tap-a-word on grammar example sentences). core/grammar.js stays
// pure (points passed in); THIS module owns the "is it loaded yet" state.
//
// grammarPointOf() is deliberately SYNC and fails soft (null before the chunk lands) so the
// flashcard render never awaits — a grammar card whose catalog isn't up yet renders as a
// plain label/mean card (no cloze) for that one paint; ensureGrammarPoints() is kicked from
// initGrammar/showJlpt and takes ~ms.
import { api } from '../cloud-core.js';
import { createReadThroughResource } from '../../persistence/resource.js';
import { sentenceTokens } from '../../core/index.js';

let points = null;    // the catalog array (manifest order) once loaded
let byId = null;
let loading = null;

export function ensureGrammarPoints() {
  if (points) return Promise.resolve(points);
  loading = loading || import('../../data/grammar-n3.js').then((m) => {
    points = m.GRAMMAR_N3;
    byId = new Map(points.map((p) => [p.id, p]));
    return points;
  });
  return loading;
}

// The catalog when loaded, else null (render code branches on it).
export const grammarPoints = () => points;
// Sync point lookup by durable id: the point object, or null (unknown id OR chunk not loaded).
export const grammarPointOf = (id) => (byId && byId.get(id)) || null;

// ---- GiNZA tokens for grammar example sentences (progressive enhancement) ----
// The generated catalog is the CONTENT source (the drill works offline/anon); the sentence
// store supplies only the NLP layer — tokens for the tap-a-word overlay on the answer face.
// Keyed `<pointId>:<ordinal>` (ordinal = the example's index within the point, the seed's
// link.ordinal). Empty until the server knows ownerType=grammar_point AND the offline NLP
// batch has annotated the seeded rows — both fine: grammarTokensFor() returns null and the
// answer face renders plain ruby, exactly like a stale-cache flashcard example.
let tokenMap = {};

const annotationsResource = createReadThroughResource({
  cacheKey: 'jpverbs_grammar_cache',
  fallback: {},
  validate: (v) => v && typeof v === 'object' && !Array.isArray(v),
  fetch: () => api('/v1/sentences?ownerType=grammar_point&annotate=1').then((r) => (r && r.sentences) || []),
  adapt: (sentences) => {
    const out = {};
    for (const s of sentences || []) {
      const link = (s && s.link) || {};
      const tokens = sentenceTokens(s);
      // compactLink drops a FALSY ordinal from the wire (every point's first example is
      // ordinal 0) — default it back, or example 0 would never get its tokens.
      if (link.owner_id != null && tokens) out[`${link.owner_id}:${link.ordinal ?? 0}`] = tokens;
    }
    return out;
  },
  current: () => tokenMap,
  adoptEmpty: false,   // a pre-seed/pre-annotation server answering [] must not wipe a good cache
  apply: (map) => { tokenMap = map || {}; },
});

// Fire-and-forget (initGrammar); warm() paints the cached tokens synchronously first.
export function refreshGrammarAnnotations() {
  annotationsResource.warm();
  return annotationsResource.refresh();
}
export const grammarTokensFor = (pointId, ordinal) => tokenMap[`${pointId}:${ordinal}`] || null;
