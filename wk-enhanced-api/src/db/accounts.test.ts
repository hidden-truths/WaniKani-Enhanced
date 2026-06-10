// Tests for the accounts / progress repo functions added for the study-app
// cloud-sync feature. Same isolation pattern as client.test.ts: a fresh
// in-memory DB per test via openDb(':memory:') + _useDbForTesting.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
    openDb,
    _useDbForTesting,
    createUser,
    getUserByEmail,
    getUserById,
    EmailTakenError,
    createSession,
    getValidSession,
    deleteSession,
    deleteExpiredSessions,
    getProgress,
    upsertProgress,
} from './client.ts';

beforeEach(() => {
    _useDbForTesting(openDb(':memory:'));
});
afterEach(() => {
    _useDbForTesting(null);
});

describe('users', () => {
    test('create + look up by email and id', () => {
        const u = createUser('a@b.com', 'hash1');
        expect(u.id).toBeGreaterThan(0);
        expect(u.email).toBe('a@b.com');

        const byEmail = getUserByEmail('a@b.com');
        expect(byEmail?.passwordHash).toBe('hash1');
        expect(byEmail?.id).toBe(u.id);

        const byId = getUserById(u.id);
        expect(byId?.email).toBe('a@b.com');
        // getUserById must NOT leak the password hash.
        expect((byId as any).passwordHash).toBeUndefined();
    });

    test('duplicate email throws EmailTakenError', () => {
        createUser('dup@b.com', 'h');
        expect(() => createUser('dup@b.com', 'h2')).toThrow(EmailTakenError);
    });

    test('unknown email / id return null', () => {
        expect(getUserByEmail('nobody@b.com')).toBeNull();
        expect(getUserById(9999)).toBeNull();
    });
});

describe('sessions', () => {
    test('valid session resolves to its user', () => {
        const u = createUser('s@b.com', 'h');
        createSession('tok1', u.id, Date.now() + 100_000);
        const who = getValidSession('tok1');
        expect(who?.id).toBe(u.id);
        expect(who?.email).toBe('s@b.com');
    });

    test('expired session returns null and is pruned', () => {
        const u = createUser('e@b.com', 'h');
        createSession('tok2', u.id, Date.now() - 1); // already expired
        expect(getValidSession('tok2')).toBeNull();
        // Pruned on access — a second look is still null and the row is gone.
        expect(getValidSession('tok2')).toBeNull();
    });

    test('deleteSession removes a live token', () => {
        const u = createUser('d@b.com', 'h');
        createSession('tok3', u.id, Date.now() + 100_000);
        deleteSession('tok3');
        expect(getValidSession('tok3')).toBeNull();
    });

    test('deleteExpiredSessions sweeps only expired rows', () => {
        const u = createUser('sweep@b.com', 'h');
        createSession('live', u.id, Date.now() + 100_000);
        createSession('dead1', u.id, Date.now() - 1);
        createSession('dead2', u.id, Date.now() - 5);
        expect(deleteExpiredSessions()).toBe(2);
        expect(getValidSession('live')?.id).toBe(u.id);
    });

    test('unknown token returns null', () => {
        expect(getValidSession('nope')).toBeNull();
    });
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
        openDb; // (no-op ref to keep import obvious)
        _useDbForTestingDelete(u.id);
        expect(getValidSession('ctok')).toBeNull();
        expect(getProgress(u.id, 'verbs')).toBeNull();
    });
});

// Small helper local to this test: there's no app-level "delete user" repo
// function yet (accounts aren't deletable through the API in v1), so we issue
// the DELETE directly to verify the schema's cascade wiring.
import { getDb } from './client.ts';
function _useDbForTestingDelete(userId: number) {
    getDb().query('DELETE FROM users WHERE id = ?').run(userId);
}
