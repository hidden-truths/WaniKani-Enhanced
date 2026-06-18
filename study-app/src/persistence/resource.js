// Read-through RESOURCE — the one place the "warm from cache, fetch from the server, degrade on
// failure" workflow lives. It sits one layer above createReadThroughCache (which owns only the
// localStorage round-trip) and absorbs the fetch/adapt/cache-write/offline-fallback dance that was
// hand-rolled — with subtly varying try/catch and NO concurrency guard — in four feature modules:
// the deck's example sentences, Self-Talk phrases + slot-swap templates, and the Songs library.
//
// What it adds over a bare `try { fetch } catch { read cache }`:
//   • SINGLE-FLIGHT. Concurrent refresh() calls share ONE in-flight fetch instead of racing two
//     network round-trips and clobbering the cache + in-memory state in undefined order. This is a
//     real bug the old code had: the Self-Talk tab's init (index.js) and its first render (view.js)
//     both call refreshPhrases(), and they overlap. Coalescing is safe because overlapping callers
//     always see the same auth state (the cookie can't change mid-flight); a refresh fired AFTER a
//     prior one resolved starts fresh (inFlight is cleared in `finally`), so a post-sign-in pull is
//     never served stale anon data. A caller that needs a guaranteed-fresh read past the coalescer
//     passes refresh({ force: true }).
//   • UNIFORM OFFLINE DEGRADE. On a failed/offline fetch the resource keeps the last good data and,
//     when the live value is still empty (cold first load), falls back to the cache — exactly once,
//     in one place, instead of four slightly-different copies.
//   • EMPTY-CLOBBER GUARD. `adoptEmpty:false` makes a transient empty fetch (a server returning
//     `{sentences:[]}` mid-warm) NOT overwrite good cached data — the example-sentences path needed
//     this and hand-rolled `if (Object.keys(levels).length)`; now it's a declared policy.
//
// The resource is DOM-free and dependency-injected (fetch/adapt/apply are passed in), so it unit-tests
// hermetically with a fake fetch + fake localStorage — no app state, no network. Each consumer owns
// only its endpoint, its adapter, and where the value lands; the resilience lives here, once.
//
//   const phrases = createReadThroughResource({
//     cacheKey: 'jpverbs_selftalk_cache',
//     fetch:   () => api('/v1/sentences?ownerType=selftalk&annotate=1').then((r) => (r && r.sentences) || []),
//     adapt:   (rows) => rows.map(sentenceToPhrase),
//     current: () => S.storePhrases,        // the live in-memory value (drives warm + degrade)
//     apply:   (v) => { S.storePhrases = v; },
//   });
//   phrases.warm();                          // sync: paint the last good fetch immediately
//   await phrases.refresh();                 // freshen from the server (coalesced, degrades offline)

import { createReadThroughCache } from './cache.js';

// Default emptiness test: covers the two shapes the resources use — an array (phrases/templates/
// songs) and an object map (example sentences keyed by rank). null/undefined count as empty.
function defaultIsEmpty(v) {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

// Options:
//   cacheKey/validate/fallback — build the backing createReadThroughCache (the array defaults suit
//                                phrases/templates/songs). OMIT and pass `cache` to reuse an existing
//                                cache instance (the example-sentences path shares one with state.js's
//                                synchronous boot hydration, so its key lives in exactly one place).
//   cache       — an existing { read, write } to use instead of building one from cacheKey.
//   fetch()     — async () => raw. The network call; MUST throw on failure (api() does). REQUIRED.
//   adapt(raw)  — raw → the value to store/apply (default: identity).
//   apply(v)    — land the value: assign it into app state + run side effects. REQUIRED.
//   current()   — () => the live in-memory value. When present, enables warm() and the
//                 degrade-to-cache-on-failure path (only when current() is empty). OMIT to make a
//                 failed fetch a pure no-op (the example path hydrates from cache at module-eval).
//   adoptEmpty  — on a SUCCESSFUL fetch, adopt an empty value? Default true. false ⇒ a blank fetch is
//                 ignored (return ok) so it can't clobber good cached/live data.
//   isEmpty(v)  — emptiness test for adoptEmpty + the degrade guard (default: array/object/null aware).
export function createReadThroughResource({
  cacheKey,
  validate,
  fallback,
  cache,
  fetch: doFetch,
  adapt = (raw) => raw,
  apply,
  current,
  adoptEmpty = true,
  isEmpty = defaultIsEmpty,
}) {
  if (typeof doFetch !== 'function') throw new TypeError('createReadThroughResource: fetch is required');
  if (typeof apply !== 'function') throw new TypeError('createReadThroughResource: apply is required');
  const store = cache || createReadThroughCache({ key: cacheKey, validate, fallback });

  let inFlight = null;   // the single in-flight refresh promise; null when idle (cleared in finally)

  // Synchronously paint the last good fetch so the first frame isn't blank. No-op without current()
  // (a consumer that hydrates its state elsewhere — e.g. at module-eval — doesn't need it).
  function warm() {
    if (!current) return store.read();
    const v = store.read();
    apply(v);
    return v;
  }

  // Fetch → adapt → adopt + cache, with single-flight coalescing and an offline degrade. Resolves to
  // true on a successful network refresh, false on failure (offline / server down) — matching the old
  // refreshPhrases()/refreshTemplates() return contract. Never rejects: a fetch failure degrades.
  function refresh({ force = false } = {}) {
    if (inFlight && !force) return inFlight;   // coalesce concurrent callers onto the in-flight fetch
    const run = (async () => {
      try {
        const value = adapt(await doFetch());
        // A blank fetch must not clobber good data when the consumer opted out of empties.
        if (!adoptEmpty && isEmpty(value)) return true;
        apply(value);
        store.write(value);
        return true;
      } catch (e) {
        // Offline / persistent failure: keep what we have. If we have nothing live yet (cold load),
        // fall back to the cache so the UI still paints. Done only when current() reports empty so a
        // good live value from an earlier success is never downgraded.
        if (current && isEmpty(current())) apply(store.read());
        return false;
      } finally {
        // Only the owner of the current in-flight slot clears it — a forced refresh ran off to the
        // side and must not null out a different refresh's slot.
        if (inFlight === run) inFlight = null;
      }
    })();
    if (!force) inFlight = run;
    return run;
  }

  return {
    warm,
    refresh,
    cached: () => store.read(),     // the persisted cache value (degrade source / debug)
    save: (value) => store.write(value),   // persist directly — for optimistic local mutations (authoring)
  };
}
