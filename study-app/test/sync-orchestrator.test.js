// Tests for the sync orchestrator (src/net/sync-orchestrator.js) — the GROUP operations (pull-all /
// flush-all / bus-wire) over the SyncedBlob registry that cloud.js delegates to. The factory is pure +
// dependency-injected, so the unit tests drive it with fake blobs / queue / sync; the final two
// integration tests wire REAL createSyncedBlobs (cloud-core's api + the offline queue mocked) to prove
// the orchestrator drives the genuine pull/flush flow end-to-end.
import { test, expect, beforeEach, vi } from 'vitest';

// cloud-core + sync-queue are mocked so the integration tests can build real SyncedBlobs without a DOM
// or a live server (mirrors synced-blob.test.js). The pure unit tests inject their own fakes and don't
// touch these. A getter on `account` lets a test flip signed-out.
const ctx = vi.hoisted(() => ({ account: { id: 1 } }));
vi.mock('../src/features/cloud-core.js', () => ({
  get account() { return ctx.account; },
  api: vi.fn(),
  setSyncStatus: vi.fn(),
}));
vi.mock('../src/net/sync-queue.js', () => ({
  enqueue: vi.fn(), remove: vi.fn(), flush: vi.fn(), clear: vi.fn(),
}));

import { api } from '../src/features/cloud-core.js';
import * as mockedQueue from '../src/net/sync-queue.js';
import { createSyncedBlob } from '../src/features/synced-blob.js';
import { createSyncOrchestrator } from '../src/net/sync-orchestrator.js';

beforeEach(() => { ctx.account = { id: 1 }; vi.resetAllMocks(); });

// A fake blob carrying exactly the SyncedBlob surface the orchestrator touches.
function fakeBlob(appKey, over = {}) {
  return {
    appKey,
    queueKey: 'progress:' + appKey,
    schedule: vi.fn(),
    pull: vi.fn().mockResolvedValue(undefined),
    _setLastUpdatedAt: vi.fn(),
    ...over,
  };
}

// Build an orchestrator over a fixed registry + injectable collaborators (own fake queue/sync).
function harness({ entries = [], account = { id: 7 }, flush } = {}) {
  const queue = { flush: flush || vi.fn().mockResolvedValue(0) };
  const sync = {};
  const acc = { current: account };
  const orch = createSyncOrchestrator({
    registry: () => entries,
    queue,
    sync,
    getAccount: () => acc.current,
  });
  return { orch, queue, sync, acc };
}

// ───────────────────────── pullAll ─────────────────────────

test('pullAll pulls every registered blob, in registry order', async () => {
  const order = [];
  const mk = (id) => fakeBlob(id, { pull: vi.fn().mockImplementation(async () => { order.push(id); }) });
  const a = mk('a'), b = mk('b'), c = mk('c');
  const { orch } = harness({ entries: [
    { blob: a, busKey: 'a' }, { blob: b, busKey: null }, { blob: c, busKey: 'c' },
  ] });
  const pulled = await orch.pullAll();
  expect(order).toEqual(['a', 'b', 'c']);   // sequential, in registry order
  expect(pulled).toBe(3);
});

test('pullAll ISOLATES a failing blob — the blobs after it still pull (resilience)', async () => {
  const a = fakeBlob('a');
  const b = fakeBlob('b', { pull: vi.fn().mockRejectedValue(new Error('afterPull blew up')) });
  const c = fakeBlob('c');
  const { orch } = harness({ entries: [
    { blob: a, busKey: null }, { blob: b, busKey: null }, { blob: c, busKey: null },
  ] });
  await expect(orch.pullAll()).resolves.toBe(2);   // a + c succeeded; b's throw isolated
  expect(a.pull).toHaveBeenCalled();
  expect(c.pull).toHaveBeenCalled();               // NOT short-circuited by b's failure
});

test('pullAll never rejects even when every blob fails — returns 0', async () => {
  const boom = () => fakeBlob('x', { pull: vi.fn().mockRejectedValue(new Error('down')) });
  const { orch } = harness({ entries: [{ blob: boom(), busKey: null }, { blob: boom(), busKey: null }] });
  await expect(orch.pullAll()).resolves.toBe(0);
});

test('pullAll on an empty registry is a no-op returning 0', async () => {
  const { orch } = harness({ entries: [] });
  await expect(orch.pullAll()).resolves.toBe(0);
});

// ───────────────────────── flushAll ─────────────────────────

test('flushAll is a no-op returning 0 when signed out — never touches the queue', async () => {
  const { orch, queue } = harness({ entries: [{ blob: fakeBlob('a'), busKey: 'a' }], account: null });
  await expect(orch.flushAll()).resolves.toBe(0);
  expect(queue.flush).not.toHaveBeenCalled();   // queued writes are per-account
});

test('flushAll flushes the queue for the current account id and returns its count', async () => {
  const flush = vi.fn().mockResolvedValue(3);
  const { orch } = harness({ entries: [{ blob: fakeBlob('a'), busKey: 'a' }], account: { id: 42 }, flush });
  await expect(orch.flushAll()).resolves.toBe(3);
  expect(flush).toHaveBeenCalledWith(42, expect.any(Function));
});

test('flushAll onFlushed bumps the MATCHING blob lastUpdatedAt by queueKey', async () => {
  const a = fakeBlob('a');   // queueKey 'progress:a'
  const b = fakeBlob('b');   // queueKey 'progress:b'
  const flush = vi.fn().mockImplementation(async (_id, onFlushed) => { onFlushed('progress:b', { updatedAt: 99 }); return 1; });
  const { orch } = harness({ entries: [{ blob: a, busKey: 'a' }, { blob: b, busKey: 'b' }], flush });
  await orch.flushAll();
  expect(b._setLastUpdatedAt).toHaveBeenCalledWith(99);
  expect(a._setLastUpdatedAt).not.toHaveBeenCalled();   // only the owning blob is bumped
});

test('flushAll onFlushed ignores an unknown queueKey and a non-numeric updatedAt (defensive)', async () => {
  const a = fakeBlob('a');
  const flush = vi.fn().mockImplementation(async (_id, onFlushed) => {
    onFlushed('session:abc-uuid', { updatedAt: 5 });   // the durable session log key — not a blob → ignored
    onFlushed('progress:a', { updatedAt: 'nope' });     // non-numeric → ignored
    onFlushed('progress:a', {});                         // missing updatedAt → ignored
    return 0;
  });
  const { orch } = harness({ entries: [{ blob: a, busKey: 'a' }], flush });
  await expect(orch.flushAll()).resolves.toBe(0);
  expect(a._setLastUpdatedAt).not.toHaveBeenCalled();
});

// ───────────────────────── wireBus ─────────────────────────

test('wireBus wires each bus-keyed blob schedule onto the bus and SKIPS a null busKey (minna)', () => {
  const prog = fakeBlob('verbs'), minna = fakeBlob('minna'), songs = fakeBlob('songs');
  const { orch, sync } = harness({ entries: [
    { blob: prog, busKey: 'progress' },
    { blob: minna, busKey: null },
    { blob: songs, busKey: 'songs' },
  ] });
  orch.wireBus();
  expect(sync.progress).toBe(prog.schedule);
  expect(sync.songs).toBe(songs.schedule);
  expect(sync.minna).toBeUndefined();   // off-bus — saveMinna schedules minnaBlob directly
});

test('wireBus integration — invoking a wired bus slot calls THAT blob schedule', () => {
  const prog = fakeBlob('verbs');
  const { orch, sync } = harness({ entries: [{ blob: prog, busKey: 'progress' }] });
  orch.wireBus();
  sync.progress();   // what a persistence save() does
  expect(prog.schedule).toHaveBeenCalledTimes(1);
});

// ───────────────────────── lazy registry (cycle-safety) ─────────────────────────

test('the registry is read LAZILY on each call — a blob registered after construction is still seen', async () => {
  // Models the cloud⇄minna import cycle: minnaBlob is bound AFTER the orchestrator is constructed, so a
  // registry captured at construction time would miss it. The thunk must be re-read on every operation.
  let entries = [];
  const orch = createSyncOrchestrator({
    registry: () => entries, queue: { flush: vi.fn() }, sync: {}, getAccount: () => ({ id: 1 }),
  });
  const late = fakeBlob('late');
  entries = [{ blob: late, busKey: null }];   // registered only now
  await orch.pullAll();
  expect(late.pull).toHaveBeenCalled();       // the thunk picked it up → no eval-time capture
});

// ───────────────────────── integration: REAL SyncedBlobs ─────────────────────────

test('integration: pullAll drives REAL SyncedBlobs (server-wins) + records each updatedAt', async () => {
  const localA = {}, localB = {};
  const blobA = createSyncedBlob({ appKey: 'a', read: () => localA.v, apply: (d) => { if (d) { localA.v = d; return true; } return false; } });
  const blobB = createSyncedBlob({ appKey: 'b', read: () => localB.v, apply: (d) => { if (d) { localB.v = d; return true; } return false; } });
  api.mockImplementation(async (path) => {
    if (path === '/v1/progress/a') return { data: { x: 1 }, updatedAt: 10 };
    if (path === '/v1/progress/b') return { data: { y: 2 }, updatedAt: 20 };
    return null;
  });
  const orch = createSyncOrchestrator({
    registry: () => [{ blob: blobA, busKey: 'a' }, { blob: blobB, busKey: 'b' }],
    queue: mockedQueue, sync: {}, getAccount: () => ctx.account,
  });
  await expect(orch.pullAll()).resolves.toBe(2);
  expect(localA.v).toEqual({ x: 1 });    // server-wins applied through the real blob
  expect(localB.v).toEqual({ y: 2 });
  expect(blobA.lastUpdatedAt).toBe(10);
  expect(blobB.lastUpdatedAt).toBe(20);
});

test('integration: flushAll bumps a REAL blob lastUpdatedAt from the queue replay', async () => {
  const blobA = createSyncedBlob({ appKey: 'a', read: () => ({}), apply: () => true });
  // the queue replays blobA's offline write and reports the server's new updatedAt
  mockedQueue.flush.mockImplementation(async (_id, onFlushed) => { onFlushed('progress:a', { updatedAt: 55 }); return 1; });
  const orch = createSyncOrchestrator({
    registry: () => [{ blob: blobA, busKey: 'a' }],
    queue: mockedQueue, sync: {}, getAccount: () => ctx.account,
  });
  await expect(orch.flushAll()).resolves.toBe(1);
  expect(blobA.lastUpdatedAt).toBe(55);   // bumped via _setLastUpdatedAt, mapped by queueKey
});
