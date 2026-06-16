// Read-through cache for the built-in vocab example sentences (Phase 2 of the unified sentence
// store). The deck fetches examples from the server store (GET /v1/sentences?ownerType=card) and
// keeps the last good fetch here so the answer-side example + Browse modal still render offline /
// on a server hiccup. The cached value is the `v.levels` model: { [rank]: { N5:[jp,en], … } }.
// data/examples.js is the SEED SOURCE (no longer read at runtime); this cache + the fetch are.
import { createReadThroughCache } from './cache.js';

// The stored value is an object map (not an array), so override the default array validator.
const cache = createReadThroughCache({
  key: 'jpverbs_examples_cache',
  validate: (o) => !!o && typeof o === 'object',
  fallback: () => ({}),
});

export function loadExampleCache() { return cache.read(); }
export function saveExampleCache(levels) { cache.write(levels || {}); }
