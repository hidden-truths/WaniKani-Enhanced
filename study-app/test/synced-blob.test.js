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
}));
vi.mock('../src/net/sync-queue.js', () => ({
  enqueue: vi.fn(), remove: vi.fn(), flush: vi.fn(), clear: vi.fn(),
}));

import { api, setSyncStatus } from '../src/features/cloud-core.js';
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
