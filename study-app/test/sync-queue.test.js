// Tests for the durable offline write-queue (src/net/sync-queue.js): localStorage round-trip,
// dedup-by-key, per-account flush, and the 409-drops / transient-keeps replay policy.
import { test, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the transport so flush() replays against a controllable api().
vi.mock('../src/net/transport.js', () => ({ api: vi.fn() }));
import { api } from '../src/net/transport.js';
import { enqueue, remove, clear, peek, size, flush } from '../src/net/sync-queue.js';

const entry = (over = {}) => ({ key: 'progress:verbs', path: '/v1/progress/verbs', method: 'PUT', body: { data: 1 }, accountId: 1, ...over });

// The test-env localStorage is a partial stub; install a complete Map-backed one so the
// queue's getItem/setItem round-trip is exercised hermetically (and isolated per test).
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

test('enqueue persists to localStorage (survives reload)', () => {
  enqueue(entry());
  expect(size()).toBe(1);
  // peek() reads fresh from localStorage — simulates a reload.
  expect(peek()[0]).toMatchObject({ key: 'progress:verbs', path: '/v1/progress/verbs', method: 'PUT' });
});

test('dedup by key — a newer write replaces the older', () => {
  enqueue(entry({ body: { v: 1 } }));
  enqueue(entry({ body: { v: 2 } }));
  expect(size()).toBe(1);
  expect(peek()[0].body).toEqual({ v: 2 });
});

test('different keys coexist in FIFO order', () => {
  enqueue(entry({ key: 'progress:verbs', path: '/p/verbs' }));
  enqueue(entry({ key: 'progress:settings', path: '/p/settings' }));
  expect(peek().map((e) => e.key)).toEqual(['progress:verbs', 'progress:settings']);
});

test('flush replays each entry with retry:true and removes on success', async () => {
  api.mockResolvedValue({ ok: true, updatedAt: 99 });
  enqueue(entry({ key: 'progress:verbs', path: '/v1/progress/verbs', body: { data: 1 } }));
  enqueue(entry({ key: 'progress:settings', path: '/v1/progress/settings', body: { data: 2 } }));
  const flushed = await flush(1);
  expect(flushed).toBe(2);
  expect(size()).toBe(0);
  expect(api).toHaveBeenCalledWith('/v1/progress/verbs', { method: 'PUT', body: { data: 1 }, retry: true });
});

test('flush invokes onFlushed(key, response) per success', async () => {
  api.mockResolvedValue({ ok: true, updatedAt: 42 });
  enqueue(entry());
  const seen = [];
  await flush(1, (key, r) => seen.push([key, r.updatedAt]));
  expect(seen).toEqual([['progress:verbs', 42]]);
});

test('flush drops a 409 entry (stale — pull reconciles)', async () => {
  const err = new Error('conflict'); err.status = 409;
  api.mockRejectedValue(err);
  enqueue(entry());
  expect(await flush(1)).toBe(0);
  expect(size()).toBe(0);
});

test('flush keeps an entry on transient/offline failure', async () => {
  api.mockRejectedValue(new Error('down'));   // no .status → network failure
  enqueue(entry());
  expect(await flush(1)).toBe(0);
  expect(size()).toBe(1);
});

test('flush skips entries tagged with a different account', async () => {
  api.mockResolvedValue({ ok: true });
  enqueue(entry({ accountId: 2 }));
  expect(await flush(1)).toBe(0);
  expect(size()).toBe(1);
  expect(api).not.toHaveBeenCalled();
});

test('clear empties the queue (sign-out)', () => {
  enqueue(entry());
  clear();
  expect(size()).toBe(0);
});

test('remove drops a single key', () => {
  enqueue(entry({ key: 'a', path: '/a' }));
  enqueue(entry({ key: 'b', path: '/b' }));
  remove('a');
  expect(peek().map((e) => e.key)).toEqual(['b']);
});
