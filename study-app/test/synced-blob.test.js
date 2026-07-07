// Tests for the SyncedBlob factory (src/features/synced-blob.js): debounced schedule, push
// success/offline/409-reconcile, pull server-wins vs fresh-account-seed, the account guard, and
// the baseUpdatedAt (B4) round-trip. cloud-core (account/api/setSyncStatus) and the offline queue
// are mocked so we can drive every branch.
import { test, expect, beforeEach, afterEach, vi } from 'vitest';

// vi.mock factories are hoisted above imports — share mutable state via vi.hoisted().
const ctx = vi.hoisted(() => ({ account: { id: 1 } }));
vi.mock('../src/features/cloud-core.js', () => ({
  get account() { return ctx.account; },   // getter so a test can flip signed-out
  api: vi.fn(),
  setSyncStatus: vi.fn(),
  handleAuthExpired: vi.fn(),
}));
vi.mock('../src/net/sync-queue.js', () => ({
  enqueue: vi.fn(), remove: vi.fn(), flush: vi.fn(), clear: vi.fn(),
}));

import { api, setSyncStatus, handleAuthExpired } from '../src/features/cloud-core.js';
import * as queue from '../src/net/sync-queue.js';
import { createSyncedBlob } from '../src/features/synced-blob.js';

beforeEach(() => { ctx.account = { id: 1 }; vi.resetAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

// A progress-like blob; `applied` records every apply(data) call so tests can assert server-wins.
function makeBlob(over = {}) {
  const applied = [];
  const blob = createSyncedBlob({
    appKey: 'verbs',
    read: () => ({ cards: { 1: { box: 2 } } }),
    apply: (data) => { applied.push(data); return !!(data && data.cards); },
    ...over,
  });
  return { blob, applied };
}

// A merge-enabled blob whose apply() UPDATES what read() returns — mirrors production, where apply()
// writes the live store the subsequent push() re-reads. Needed to exercise the merge → re-push path
// (the fixed-read makeBlob can't, since its read() never reflects the applied merge).
function makeMergeBlob(initialLocal, merge) {
  let local = initialLocal;
  const applied = [];
  const blob = createSyncedBlob({
    appKey: 'verbs',
    read: () => local,
    apply: (data) => { applied.push(data); if (data && data.cards) { local = data; return true; } return false; },
    merge,
  });
  return { blob, applied };
}

test('push success → PUT, saving→synced status, clears any queued copy, records updatedAt', async () => {
  api.mockResolvedValue({ ok: true, updatedAt: 50 });
  const { blob } = makeBlob();
  await blob.push();
  expect(api).toHaveBeenCalledWith('/v1/progress/verbs', { method: 'PUT', body: { data: { cards: { 1: { box: 2 } } } } });
  expect(setSyncStatus).toHaveBeenCalledWith('saving…');
  expect(setSyncStatus).toHaveBeenCalledWith('✓ synced');
  expect(queue.remove).toHaveBeenCalledWith('progress:verbs');
  expect(blob.lastUpdatedAt).toBe(50);
});

test('the second push sends baseUpdatedAt from the first response (B4)', async () => {
  api.mockResolvedValue({ ok: true, updatedAt: 50 });
  const { blob } = makeBlob();
  await blob.push();   // first omits baseUpdatedAt
  await blob.push();   // second carries it
  expect(api).toHaveBeenLastCalledWith('/v1/progress/verbs', { method: 'PUT', body: { data: { cards: { 1: { box: 2 } } }, baseUpdatedAt: 50 } });
});

test('push failure (offline) → enqueues the write + ⚠ offline', async () => {
  api.mockRejectedValue(new Error('down'));   // no .status → network failure
  const { blob } = makeBlob();
  await blob.push();
  expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
    key: 'progress:verbs', path: '/v1/progress/verbs', method: 'PUT', accountId: 1,
  }));
  expect(setSyncStatus).toHaveBeenLastCalledWith('⚠ offline');
});

test('push 409 → reconcile applies the server copy (server-wins), no enqueue', async () => {
  const err = new Error('conflict');
  err.status = 409;
  err.body = { data: { cards: { 9: { box: 5 } } }, updatedAt: 77 };
  api.mockRejectedValue(err);
  const { blob, applied } = makeBlob();
  await blob.push();
  expect(applied).toContainEqual({ cards: { 9: { box: 5 } } });   // adopted server state
  expect(blob.lastUpdatedAt).toBe(77);
  expect(queue.enqueue).not.toHaveBeenCalled();
  expect(setSyncStatus).toHaveBeenLastCalledWith('✓ synced');
});

test('push 409 with merge() → unions local+server, applies it, re-pushes with the server base (E1)', async () => {
  const merge = (local, server) => ({ cards: { ...local.cards, ...server.cards } });   // union for the test
  const err = new Error('conflict'); err.status = 409;
  err.body = { data: { cards: { 9: { box: 5 } } }, updatedAt: 77 };
  api.mockRejectedValueOnce(err).mockResolvedValueOnce({ ok: true, updatedAt: 88 });   // live push 409s, merge re-push OK
  const { blob, applied } = makeMergeBlob({ cards: { 1: { box: 2 } } }, merge);
  await blob.push();
  expect(applied).toContainEqual({ cards: { 1: { box: 2 }, 9: { box: 5 } } });   // merged union applied (no data lost)
  // the re-push (call #2) carries the merged data + the server's updatedAt as the new base
  expect(api).toHaveBeenNthCalledWith(2, '/v1/progress/verbs', {
    method: 'PUT', body: { data: { cards: { 1: { box: 2 }, 9: { box: 5 } } }, baseUpdatedAt: 77 },
  });
  expect(blob.lastUpdatedAt).toBe(88);            // re-push's updatedAt recorded
  expect(queue.enqueue).not.toHaveBeenCalled();
  expect(setSyncStatus).toHaveBeenLastCalledWith('✓ synced');
});

test('merge re-push that 409s AGAIN falls back to server-wins — single round, no loop (E1)', async () => {
  const merge = vi.fn((local, server) => ({ cards: { ...local.cards, ...server.cards } }));
  const err1 = new Error('conflict'); err1.status = 409; err1.body = { data: { cards: { 9: { box: 5 } } }, updatedAt: 77 };
  const err2 = new Error('conflict'); err2.status = 409; err2.body = { data: { cards: { 7: { box: 3 } } }, updatedAt: 99 };
  api.mockRejectedValueOnce(err1).mockRejectedValueOnce(err2);   // both the live push AND the merge re-push 409
  const { blob, applied } = makeMergeBlob({ cards: { 1: { box: 2 } } }, merge);
  await blob.push();
  expect(merge).toHaveBeenCalledTimes(1);                          // merged ONCE; the 2nd 409 did not merge again
  expect(applied[applied.length - 1]).toEqual({ cards: { 7: { box: 3 } } });   // server-wins on the 2nd conflict
  expect(blob.lastUpdatedAt).toBe(99);
  expect(api).toHaveBeenCalledTimes(2);                            // live push + one merge re-push (no third)
  expect(queue.enqueue).not.toHaveBeenCalled();
});

test('push 401 → re-queues the write + fires handleAuthExpired, NOT ⚠ offline (expired session)', async () => {
  const err = new Error('unauthorized'); err.status = 401;
  api.mockRejectedValue(err);
  const { blob } = makeBlob();
  await blob.push();
  expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ key: 'progress:verbs', accountId: 1 }));   // write preserved for replay on re-login
  expect(handleAuthExpired).toHaveBeenCalled();
  expect(setSyncStatus).not.toHaveBeenCalledWith('⚠ offline');   // a 401 is expiry, not a network blip
});

test('pull 401 → fires handleAuthExpired, does NOT call onOffline', async () => {
  const err = new Error('unauthorized'); err.status = 401;
  api.mockRejectedValue(err);
  const onOffline = vi.fn();
  const { blob } = makeBlob({ onOffline });
  await blob.pull();
  expect(handleAuthExpired).toHaveBeenCalled();
  expect(onOffline).not.toHaveBeenCalled();
});

test('push is a no-op when signed out', async () => {
  ctx.account = null;
  const { blob } = makeBlob();
  await blob.push();
  expect(api).not.toHaveBeenCalled();
});

test('pull applies server data (server-wins) + runs afterPull + records updatedAt', async () => {
  api.mockResolvedValue({ data: { cards: { 2: { box: 1 } } }, updatedAt: 60 });
  const after = vi.fn();
  const { blob, applied } = makeBlob({ afterPull: after });
  await blob.pull();
  expect(applied).toContainEqual({ cards: { 2: { box: 1 } } });
  expect(after).toHaveBeenCalled();
  expect(blob.lastUpdatedAt).toBe(60);
});

test('pull on a fresh account (server empty) seeds via push', async () => {
  api.mockResolvedValueOnce({ data: null, updatedAt: null }).mockResolvedValue({ ok: true, updatedAt: 5 });
  const { blob } = makeBlob({ shouldSeed: () => true });
  await blob.pull();
  expect(api).toHaveBeenCalledTimes(2);   // GET then the seeding PUT
  expect(api).toHaveBeenLastCalledWith('/v1/progress/verbs', { method: 'PUT', body: { data: { cards: { 1: { box: 2 } } } } });
});

test('pull does NOT seed when shouldSeed() is false', async () => {
  api.mockResolvedValue({ data: null, updatedAt: null });
  const { blob } = makeBlob({ shouldSeed: () => false });
  await blob.pull();
  expect(api).toHaveBeenCalledTimes(1);   // GET only
});

test('pull offline → onOffline hook, no throw', async () => {
  api.mockRejectedValue(new Error('down'));
  const onOffline = vi.fn();
  const { blob } = makeBlob({ onOffline });
  await expect(blob.pull()).resolves.toBeUndefined();
  expect(onOffline).toHaveBeenCalled();
});

test('schedule debounces repeated calls into one push', async () => {
  vi.useFakeTimers();
  api.mockResolvedValue({ ok: true, updatedAt: 1 });
  const { blob } = makeBlob({ debounceMs: 1200 });
  blob.schedule(); blob.schedule(); blob.schedule();
  await vi.advanceTimersByTimeAsync(1200);
  expect(api).toHaveBeenCalledTimes(1);
});
