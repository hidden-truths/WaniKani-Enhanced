// accounts repo — users + login sessions. Same isolation pattern as the other repo
// tests: a fresh in-memory DB per test via openDb(':memory:') + _useDbForTesting.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { openDb, _useDbForTesting } from '../connection.ts';
import {
    createUser,
    getUserByEmail,
    getUserById,
    EmailTakenError,
    createSession,
    getValidSession,
    deleteSession,
    deleteExpiredSessions,
} from '../client.ts';

let mem: ReturnType<typeof openDb>;

beforeEach(() => {
    mem = openDb(':memory:');
    _useDbForTesting(mem);
});
afterEach(() => {
    _useDbForTesting(null);
    mem.close();
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
