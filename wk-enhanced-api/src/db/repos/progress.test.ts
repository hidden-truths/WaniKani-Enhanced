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
        const ts = upsertProgress(u.id, 'verbs', blob);
        expect(ts).toBeGreaterThan(0);
        const row = getProgress(u.id, 'verbs');
        expect(row?.data).toEqual(blob);
        expect(row?.updatedAt).toBe(ts);
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
});

// There's no app-level "delete user" repo function yet (accounts aren't deletable through
// the API in v1), so we issue the DELETE directly to verify the schema's cascade wiring.
function deleteUserDirect(userId: number) {
    getDb().query('DELETE FROM users WHERE id = ?').run(userId);
}
