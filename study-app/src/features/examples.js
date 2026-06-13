// Built-in vocab example sentences — fetched from the server sentence store (Phase 2 of the
// unified store) instead of bundled. The deck batch-fetches every card's leveled examples once on
// boot (GET /v1/sentences?ownerType=card, ~100 cards × 5 tiers ≈ 500 per-link rows), rebuilds the
// state.exampleLevels model via the pure sentencesToLevels adapter, caches it in localStorage
// (read-through), re-attaches onto the live deck, and re-renders the answer-side example.
//
// state.exampleLevels is hydrated synchronously from the cache at module-eval (state.js), so the
// first attachLevels() at boot already has examples; this refresh just freshens them. Degrades to
// the cache on a failed/offline fetch (never blanks existing levels). data/examples.js is the SEED
// SOURCE for scripts/seed-sentences.ts — no longer read at runtime.
import { state, attachLevels } from '../state.js';
import { sentencesToLevels } from '../core/index.js';
import { api } from './cloud-core.js';
import { saveExampleCache } from '../persistence/examples.js';
import { session, renderExample } from './flashcard.js';

// Fetch the card examples, rebuild state.exampleLevels, re-attach + re-render the live example.
// Fire-and-forget from main.js (not awaited). Returns true on a successful network refresh.
export async function initExamples() {
  try {
    const r = await api('/v1/sentences?ownerType=card&annotate=1');
    const levels = sentencesToLevels((r && r.sentences) || []);
    // Guard against a transient empty fetch wiping a good cache: only adopt a non-empty set.
    if (Object.keys(levels).length) {
      state.exampleLevels = levels;
      saveExampleCache(levels);
      attachLevels();
      // If a session is mid-card, re-render its answer-side example so fresh sentences show now
      // (the Browse detail modal reads v.levels live when opened, so it needs no nudge).
      if (session && session.deck && session.deck[session.i]) renderExample(session.deck[session.i]);
    }
    return true;
  } catch (e) {
    return false;   // offline / server down → keep the cache-hydrated levels (degrade, don't blank)
  }
}
