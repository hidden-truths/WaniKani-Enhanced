// Tests for the read-through localStorage cache (src/persistence/cache.js): the storage primitive
// shared by selftalk phrases/templates, the songs library, and the deck's example sentences. Covers
// the round-trip, every degrade-to-empty branch (miss / corrupt JSON / wrong shape), the fresh-empty
// guarantee (callers mutate the result), and the swallow-all resilience (quota / private-mode throws).
import { test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createReadThroughCache } from '../src/persistence/cache.js';

// The test-env localStorage is a partial stub; install a complete Map-backed one so the
// read/write round-trip is exercised hermetically (and isolated per test) — same pattern as
// sync-queue.test.js.
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

test('write then read round-trips the value', () => {
  const cache = createReadThroughCache({ key: 'k' });
  cache.write([1, 2, 3]);
  expect(cache.read()).toEqual([1, 2, 3]);
  expect(localStorage.getItem('k')).toBe('[1,2,3]');
});

test('read returns the empty fallback on a miss (nothing stored)', () => {
  const cache = createReadThroughCache({ key: 'absent' });
  expect(cache.read()).toEqual([]);
});

test('read returns the empty fallback on corrupt JSON, no throw', () => {
  localStorage.setItem('k', '{not valid json');
  const cache = createReadThroughCache({ key: 'k' });
  expect(cache.read()).toEqual([]);
});

test('read returns the empty fallback when the stored shape fails validate', () => {
  // default validator is Array.isArray — a stored object must NOT pass it
  localStorage.setItem('k', JSON.stringify({ a: 1 }));
  const cache = createReadThroughCache({ key: 'k' });
  expect(cache.read()).toEqual([]);
});

test('read returns a FRESH empty value each call (callers mutate it)', () => {
  const cache = createReadThroughCache({ key: 'absent' });
  const a = cache.read();
  a.push('mutated');
  expect(cache.read()).toEqual([]);   // the second read is unaffected by mutating the first
  expect(cache.read()).not.toBe(a);
});

test('custom object validator + object fallback (the examples-cache shape)', () => {
  const cache = createReadThroughCache({
    key: 'ex',
    validate: (o) => !!o && typeof o === 'object',
    fallback: () => ({}),
  });
  expect(cache.read()).toEqual({});            // miss → fresh {}
  cache.write({ 1: { N5: ['a', 'b'] } });
  expect(cache.read()).toEqual({ 1: { N5: ['a', 'b'] } });
});

test('write swallows a throwing setItem (quota / private mode) — best-effort, no throw', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceeded'); },
    removeItem: () => {}, clear: () => {},
  });
  const cache = createReadThroughCache({ key: 'k' });
  expect(() => cache.write([1])).not.toThrow();
});

test('read swallows a throwing getItem — degrades to the fallback, no throw', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => {}, removeItem: () => {}, clear: () => {},
  });
  const cache = createReadThroughCache({ key: 'k' });
  expect(cache.read()).toEqual([]);
});
