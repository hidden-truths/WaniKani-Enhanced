// Read-through cache for the built-in vocab example sentences (Phase 2 of the unified sentence
// store). The deck fetches examples from the server store (GET /v1/sentences?ownerType=card) and
// keeps the last good fetch here so the answer-side example + Browse modal still render offline /
// on a server hiccup. The cached value is the `v.levels` model: { [rank]: { N5:[jp,en], … } }.
// data/examples.js is the SEED SOURCE (no longer read at runtime); this cache + the fetch are.

const KEY = 'jpverbs_examples_cache';

export function loadExampleCache() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY));
    if (o && typeof o === 'object') return o;
  } catch (e) {}
  return {};
}

export function saveExampleCache(levels) {
  try { localStorage.setItem(KEY, JSON.stringify(levels || {})); } catch (e) {}
}
