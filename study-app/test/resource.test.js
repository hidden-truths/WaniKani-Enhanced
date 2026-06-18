// Tests for the read-through RESOURCE (src/persistence/resource.js): the fetch + cache + offline-
// degrade + single-flight layer that the deck example sentences, Self-Talk phrases/templates, and the
// Songs library all sit on. The headline coverage is the resilience the bare hand-rolled try/catch
// lacked: SINGLE-FLIGHT coalescing of concurrent refreshes, a uniform offline degrade-to-cache, the
// adoptEmpty clobber-guard, and never-rejects error isolation. The localStorage stub mirrors
// cache.test.js / sync-queue.test.js so the integration tests exercise the real createReadThroughCache.
import { test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createReadThroughResource } from '../src/persistence/resource.js';

beforeEach(() => {
  const store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  });
  vi.clearAllMocks();
});
afterEach(() => { vi.unstubAllGlobals(); });

// A fetch whose resolution we control, so two refresh() calls can be made to overlap deterministically
// (no real timers / network). Each call pushes a {res,rej} onto `pending`; calls counts invocations.
function controllableFetch() {
  const pending = [];
  let calls = 0;
  return {
    fetch: () => { calls++; return new Promise((res, rej) => pending.push({ res, rej })); },
    get calls() { return calls; },
    resolveLast: (v) => pending[pending.length - 1].res(v),
    resolveAt: (i, v) => pending[i].res(v),   // settle a SPECIFIC in-flight fetch (for the force tests)
  };
}

// An in-memory cache double for the unit tests that don't need real localStorage.
function fakeCache(initial) {
  let value = initial;
  return { read: () => value, write: (v) => { value = v; }, _peek: () => value };
}

// ---- construction guards ----

test('throws without a fetch function', () => {
  expect(() => createReadThroughResource({ apply: () => {} })).toThrow(/fetch is required/);
});

test('throws without an apply function', () => {
  expect(() => createReadThroughResource({ fetch: async () => [] })).toThrow(/apply is required/);
});

// ---- warm() ----

test('warm() applies the cached value and returns it', () => {
  const cache = fakeCache([{ id: 'a' }]);
  let applied = null;
  const r = createReadThroughResource({ cache, fetch: async () => [], apply: (v) => { applied = v; }, current: () => applied });
  expect(r.warm()).toEqual([{ id: 'a' }]);
  expect(applied).toEqual([{ id: 'a' }]);
});

test('warm() is a no-op (no apply) when no current() is supplied — the boot-hydrated example path', () => {
  const cache = fakeCache({ 1: { N5: ['x'] } });
  let applyCalls = 0;
  const r = createReadThroughResource({ cache, fetch: async () => ({}), apply: () => { applyCalls++; } });
  r.warm();
  expect(applyCalls).toBe(0);   // examples hydrate state.exampleLevels at module-eval, not via warm()
});

// ---- refresh(): success ----

test('refresh() fetches, adapts, applies, and writes the cache; resolves true', async () => {
  const cache = fakeCache([]);
  let applied = null;
  const r = createReadThroughResource({
    cache,
    fetch: async () => ({ sentences: [{ raw: 1 }] }),
    adapt: (raw) => raw.sentences.map((s) => ({ n: s.raw * 10 })),
    apply: (v) => { applied = v; },
    current: () => applied,
  });
  await expect(r.refresh()).resolves.toBe(true);
  expect(applied).toEqual([{ n: 10 }]);
  expect(cache._peek()).toEqual([{ n: 10 }]);   // write-through happened
});

test('refresh() adopts an empty result by default (adoptEmpty defaults true)', async () => {
  const cache = fakeCache([{ stale: true }]);
  let applied = [{ stale: true }];
  const r = createReadThroughResource({ cache, fetch: async () => [], apply: (v) => { applied = v; }, current: () => applied });
  await r.refresh();
  expect(applied).toEqual([]);          // an empty live set is the legitimate truth here
  expect(cache._peek()).toEqual([]);
});

test('adoptEmpty:false ignores an empty fetch — no apply, no cache clobber — but still resolves true', async () => {
  const cache = fakeCache({ 1: { N5: ['good'] } });
  let applyCalls = 0;
  const r = createReadThroughResource({
    cache,
    fetch: async () => [],            // a transient empty payload mid server-warm
    adapt: () => ({}),               // → empty object map
    adoptEmpty: false,
    apply: () => { applyCalls++; },
  });
  await expect(r.refresh()).resolves.toBe(true);   // the network call DID succeed
  expect(applyCalls).toBe(0);                       // …but we didn't blank good data with it
  expect(cache._peek()).toEqual({ 1: { N5: ['good'] } });
});

// ---- refresh(): failure / offline degrade ----

test('refresh() failure resolves false and never rejects (error isolation)', async () => {
  const cache = fakeCache([]);
  const r = createReadThroughResource({ cache, fetch: async () => { throw new Error('offline'); }, apply: () => {}, current: () => [] });
  await expect(r.refresh()).resolves.toBe(false);
});

test('offline degrade: a failed fetch falls back to the cache when the live value is empty', async () => {
  const cache = fakeCache([{ id: 'cached' }]);
  let applied = [];                 // cold load — nothing live yet
  const r = createReadThroughResource({ cache, fetch: async () => { throw new Error('down'); }, apply: (v) => { applied = v; }, current: () => applied });
  await r.refresh();
  expect(applied).toEqual([{ id: 'cached' }]);   // degraded to the last good fetch
});

test('offline degrade does NOT downgrade a good live value to the cache', async () => {
  const cache = fakeCache([{ id: 'old-cache' }]);
  let applied = [{ id: 'fresh-live' }];          // a prior success populated this
  const r = createReadThroughResource({ cache, fetch: async () => { throw new Error('down'); }, apply: (v) => { applied = v; }, current: () => applied });
  await r.refresh();
  expect(applied).toEqual([{ id: 'fresh-live' }]);   // kept — never replaced by staler cache
});

test('without current(), a failed fetch is a pure no-op (no apply) — the example path', async () => {
  const cache = fakeCache({ 1: {} });
  let applyCalls = 0;
  const r = createReadThroughResource({ cache, fetch: async () => { throw new Error('down'); }, apply: () => { applyCalls++; } });
  await expect(r.refresh()).resolves.toBe(false);
  expect(applyCalls).toBe(0);
});

// ---- single-flight concurrency (the core resilience win) ----

test('single-flight: concurrent refresh() calls share ONE fetch and apply once', async () => {
  const f = controllableFetch();
  let applyCalls = 0;
  const r = createReadThroughResource({ cache: fakeCache([]), fetch: f.fetch, apply: () => { applyCalls++; }, current: () => [] });
  const p1 = r.refresh();
  const p2 = r.refresh();
  const p3 = r.refresh();
  expect(f.calls).toBe(1);                       // coalesced — not three network round-trips
  f.resolveLast([{ ok: 1 }]);
  const results = await Promise.all([p1, p2, p3]);
  expect(results).toEqual([true, true, true]);   // every waiter gets the same outcome
  expect(applyCalls).toBe(1);                     // applied exactly once
});

test('single-flight clears after settle: a later refresh fetches fresh (post-sign-in freshness)', async () => {
  const f = controllableFetch();
  const r = createReadThroughResource({ cache: fakeCache([]), fetch: f.fetch, apply: () => {}, current: () => [] });
  const p1 = r.refresh();
  f.resolveLast([{ first: 1 }]);
  await p1;
  const p2 = r.refresh();                          // fired AFTER the first settled — must not coalesce
  expect(f.calls).toBe(2);                         // a genuinely new fetch (e.g. an anon→signed-in re-pull)
  f.resolveLast([{ second: 1 }]);
  await p2;
});

test('refresh({force}) bypasses the coalescer for a guaranteed-fresh read', async () => {
  const f = controllableFetch();
  const r = createReadThroughResource({ cache: fakeCache([]), fetch: f.fetch, apply: () => {}, current: () => [] });
  const p1 = r.refresh();                          // pending[0], in-flight
  const p2 = r.refresh({ force: true });           // pending[1], must NOT join p1's in-flight fetch
  expect(f.calls).toBe(2);
  f.resolveAt(0, [{ a: 1 }]);                       // settle the coalesced one
  f.resolveAt(1, [{ b: 1 }]);                       // settle the forced one
  await Promise.all([p1, p2]);
});

test('a forced refresh settling first does not strand the coalesced slot', async () => {
  // Guards the `if (inFlight === run)` finally check: the forced run must not null another run's slot.
  const f = controllableFetch();
  let applyCalls = 0;
  const r = createReadThroughResource({ cache: fakeCache([]), fetch: f.fetch, apply: () => { applyCalls++; }, current: () => [] });
  const pNormal = r.refresh();                      // pending[0], owns inFlight
  const pForced = r.refresh({ force: true });       // pending[1], off to the side
  f.resolveAt(1, [{ forced: 1 }]);                  // settle the forced run first
  await pForced;
  // The normal run still owns inFlight, so a new caller still coalesces onto it:
  const pJoin = r.refresh();
  expect(f.calls).toBe(2);                          // joined, not a third fetch
  f.resolveAt(0, [{ normal: 1 }]);                  // settle pending[0] (the normal run)
  await Promise.all([pNormal, pJoin]);
  expect(applyCalls).toBe(2);                       // forced + normal each applied once
});

// ---- adapt / cached / save ----

test('adapt transforms the raw fetch payload before apply + cache', async () => {
  const cache = fakeCache([]);
  let applied = null;
  const r = createReadThroughResource({
    cache,
    fetch: async () => [1, 2, 3],
    adapt: (nums) => nums.map((n) => n * n),
    apply: (v) => { applied = v; },
    current: () => applied,
  });
  await r.refresh();
  expect(applied).toEqual([1, 4, 9]);
});

test('cached() reads through to the cache and save() writes it (optimistic-mutation path)', () => {
  const cache = fakeCache([{ id: 'x' }]);
  const r = createReadThroughResource({ cache, fetch: async () => [], apply: () => {} });
  expect(r.cached()).toEqual([{ id: 'x' }]);
  r.save([{ id: 'x' }, { id: 'y' }]);     // authoring upserts locally + persists via the resource
  expect(cache._peek()).toEqual([{ id: 'x' }, { id: 'y' }]);
});

// ---- integration against the REAL createReadThroughCache + localStorage ----

test('integration: offline-first then recover — degrade to a seeded cache, then adopt + persist', async () => {
  // Seed the localStorage cache as if a prior session had fetched successfully.
  localStorage.setItem('jpverbs_songs_cache', JSON.stringify([{ id: 'seeded' }]));
  const liveLibrary = { value: [] };
  let online = false;
  const r = createReadThroughResource({
    cacheKey: 'jpverbs_songs_cache',                       // real cache → real localStorage round-trip
    fetch: async () => { if (!online) throw new Error('offline'); return [{ id: 'fresh' }]; },
    current: () => liveLibrary.value,
    apply: (v) => { liveLibrary.value = v; },
  });

  // Offline open: the grid still paints from the seeded cache.
  await expect(r.refresh()).resolves.toBe(false);
  expect(liveLibrary.value).toEqual([{ id: 'seeded' }]);

  // Network recovers: adopt the fresh data and write it through to localStorage.
  online = true;
  await expect(r.refresh()).resolves.toBe(true);
  expect(liveLibrary.value).toEqual([{ id: 'fresh' }]);
  expect(JSON.parse(localStorage.getItem('jpverbs_songs_cache'))).toEqual([{ id: 'fresh' }]);
});

test('integration: a corrupt cache degrades to empty without throwing (resilience to bad storage)', async () => {
  localStorage.setItem('jpverbs_selftalk_cache', '{not json');
  let applied = null;
  const r = createReadThroughResource({
    cacheKey: 'jpverbs_selftalk_cache',
    fetch: async () => { throw new Error('offline'); },
    current: () => applied || [],
    apply: (v) => { applied = v; },
  });
  await expect(r.refresh()).resolves.toBe(false);
  expect(applied).toEqual([]);   // createReadThroughCache swallowed the corrupt JSON → fresh []
});
