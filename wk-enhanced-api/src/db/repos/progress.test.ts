// user_progress repo — the per-(user, app) opaque blob, plus the user-deletion cascade
// that drops a user's sessions + progress (the FK wiring this repo relies on).

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { openDb, _useDbForTesting, getDb } from '../connection.ts';
import { createUser, createSession, getValidSession, getProgress, upsertProgress } from '../client.ts';

let mem: ReturnType<typeof openDb>;

beforeEach(() => {
    mem = openDb(':memory:');
    _useDbForTesting(mem);
});
afterEach(() => {
    _useDbForTesting(null);
    mem.close();
});

describe('user_progress', () => {
    test('get before any save returns null', () => {
        const u = createUser('p@b.com', 'h');
        expect(getProgress(u.id, 'verbs')).toBeNull();
    });

    test('upsert then get round-trips the blob', () => {
        const u = createUser('p2@b.com', 'h');
        const blob = { cards: { 1: { box: 2 } }, sessions: [], daily: {} };
        const res = upsertProgress(u.id, 'verbs', blob);
        expect(res.ok).toBe(true);
        if (!res.ok) throw new Error('unreachable');
        expect(res.updatedAt).toBeGreaterThan(0);
        const row = getProgress(u.id, 'verbs');
        expect(row?.data).toEqual(blob);
        expect(row?.updatedAt).toBe(res.updatedAt);
    });

    test('second upsert replaces the blob in place', () => {
        const u = createUser('p3@b.com', 'h');
        upsertProgress(u.id, 'verbs', { cards: { 1: {} }, sessions: [], daily: {} });
        upsertProgress(u.id, 'verbs', { cards: { 2: {} }, sessions: [], daily: {} });
        const row = getProgress(u.id, 'verbs');
        expect(row?.data.cards).toEqual({ 2: {} });
    });

    test('progress is isolated per user and per app', () => {
        const a = createUser('iso-a@b.com', 'h');
        const b = createUser('iso-b@b.com', 'h');
        upsertProgress(a.id, 'verbs', { who: 'a' });
        upsertProgress(b.id, 'verbs', { who: 'b' });
        expect(getProgress(a.id, 'verbs')?.data).toEqual({ who: 'a' });
        expect(getProgress(b.id, 'verbs')?.data).toEqual({ who: 'b' });
        // Different app namespace for the same user is a distinct row.
        expect(getProgress(a.id, 'other' as any)).toBeNull();
    });

    test('deleting a user cascades to sessions and progress', () => {
        const u = createUser('cascade@b.com', 'h');
        createSession('ctok', u.id, Date.now() + 100_000);
        upsertProgress(u.id, 'verbs', { x: 1 });
        // FK ON DELETE CASCADE is enabled via PRAGMA foreign_keys=ON in openDb.
        deleteUserDirect(u.id);
        expect(getValidSession('ctok')).toBeNull();
        expect(getProgress(u.id, 'verbs')).toBeNull();
    });

    // ---- B4: optimistic concurrency (compare-and-set on baseUpdatedAt) ----
    // updated_at is forced to a known value so the CAS is deterministic regardless of the
    // Date.now() millisecond resolution.

    test('compare-and-set: matching baseUpdatedAt writes', () => {
        const u = createUser('cas1@b.com', 'h');
        upsertProgress(u.id, 'verbs', { v: 1 });
        setUpdatedAt(u.id, 'verbs', 1000);
        const res = upsertProgress(u.id, 'verbs', { v: 2 }, 1000);
        expect(res.ok).toBe(true);
        expect(getProgress(u.id, 'verbs')?.data).toEqual({ v: 2 });
    });

    test('compare-and-set: stale baseUpdatedAt conflicts and carries the current copy', () => {
        const u = createUser('cas2@b.com', 'h');
        upsertProgress(u.id, 'verbs', { v: 1 });
        setUpdatedAt(u.id, 'verbs', 1000);
        const res = upsertProgress(u.id, 'verbs', { v: 2 }, 999);   // stale base
        expect(res.ok).toBe(false);
        if (res.ok) throw new Error('expected a conflict');
        expect(res.current.updatedAt).toBe(1000);
        expect(res.current.data).toEqual({ v: 1 });                  // server copy returned
        expect(getProgress(u.id, 'verbs')?.data).toEqual({ v: 1 });  // not written
    });

    test('compare-and-set: a base against a not-yet-existing row inserts (no conflict)', () => {
        const u = createUser('cas3@b.com', 'h');
        const res = upsertProgress(u.id, 'settings', { theme: 'dark' }, 12345);
        expect(res.ok).toBe(true);
        expect(getProgress(u.id, 'settings')?.data).toEqual({ theme: 'dark' });
    });

    test('omitting baseUpdatedAt keeps last-write-wins (legacy path)', () => {
        const u = createUser('cas4@b.com', 'h');
        upsertProgress(u.id, 'verbs', { v: 1 });
        setUpdatedAt(u.id, 'verbs', 1000);
        const res = upsertProgress(u.id, 'verbs', { v: 2 });   // no base → unconditional
        expect(res.ok).toBe(true);
        expect(getProgress(u.id, 'verbs')?.data).toEqual({ v: 2 });
    });
});

function setUpdatedAt(userId: number, app: string, ts: number) {
    getDb().query('UPDATE user_progress SET updated_at = ? WHERE user_id = ? AND app = ?').run(ts, userId, app);
}

// There's no app-level "delete user" repo function yet (accounts aren't deletable through
// the API in v1), so we issue the DELETE directly to verify the schema's cascade wiring.
function deleteUserDirect(userId: number) {
    getDb().query('DELETE FROM users WHERE id = ?').run(userId);
}
