// Built-in vocab example sentences — fetched from the server sentence store (Phase 2 of the unified
// store) instead of bundled, modeled as a read-through RESOURCE (persistence/resource.js). The deck
// batch-fetches every card's leveled examples once on boot (GET /v1/sentences?ownerType=card, ~100
// cards × 5 tiers ≈ 500 per-link rows), rebuilds the state.exampleLevels model via the pure
// sentencesToLevels adapter, caches it in localStorage, re-attaches onto the live deck, and re-renders
// the answer-side example.
//
// state.exampleLevels is hydrated synchronously from the cache at module-eval (state.js), so the first
// attachLevels() at boot already has examples; this refresh just freshens them. The resource degrades
// to the cache on a failed/offline fetch and — via adoptEmpty:false — never lets a transient empty
// fetch wipe a good cache. The localStorage key lives in exactly one place (persistence/examples.js);
// we reuse its read/write here so state.js's boot hydration and this refresh share one cache.
// data/examples.js is the SEED SOURCE for scripts/seed-sentences.ts — no longer read at runtime.
import { state, attachLevels } from '../state.js';
import { sentencesToLevels } from '../core/index.js';
import { api } from './cloud-core.js';
import { loadExampleCache, saveExampleCache } from '../persistence/examples.js';
import { createReadThroughResource } from '../persistence/resource.js';
import { session, renderExample } from './flashcard.js';

const examplesResource = createReadThroughResource({
  cache: { read: loadExampleCache, write: saveExampleCache },   // shared with state.js boot hydration
  fetch: () => api('/v1/sentences?ownerType=card&annotate=1').then((r) => (r && r.sentences) || []),
  adapt: sentencesToLevels,
  adoptEmpty: false,   // a transient empty fetch must not blank the good example cache
  apply: (levels) => {
    state.exampleLevels = levels;
    attachLevels();
    // If a session is mid-card, re-render its answer-side example so fresh sentences show now
    // (the Browse detail modal reads v.levels live when opened, so it needs no nudge).
    if (session && session.deck && session.deck[session.i]) renderExample(session.deck[session.i]);
  },
});

// Fire-and-forget from main.js (not awaited). Resolves true on a successful network refresh, false on
// an offline/failed one (the cache-hydrated levels stay put).
export function initExamples() { return examplesResource.refresh(); }
