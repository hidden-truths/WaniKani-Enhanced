// study_sessions repo — the append-only durable session log (per-user, uncapped).

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { openDb, _useDbForTesting } from '../connection.ts';
import * as db from '../client.ts';

let mem: ReturnType<typeof openDb>;

beforeEach(() => {
    mem = openDb(':memory:');
    _useDbForTesting(mem);
});

afterEach(() => {
    _useDbForTesting(null);
    mem.close();
});

describe('study_sessions append-only log', () => {
    test('insertSession appends and countSessions counts per user', () => {
        const u = db.createUser('s@example.com', 'hash');
        expect(db.countSessions(u.id)).toBe(0);
        const id1 = db.insertSession(u.id, 1000, 4, 6, 'meaning', null);
        const id2 = db.insertSession(u.id, 2000, 2, 8, 'reading', { deck: 'leech' });
        expect(id2).toBeGreaterThan(id1);
        expect(db.countSessions(u.id)).toBe(2);
        // a second user's log is independent
        const u2 = db.createUser('t@example.com', 'hash');
        db.insertSession(u2.id, 3000, 5, 5, null, null);
        expect(db.countSessions(u2.id)).toBe(1);
        expect(db.countSessions(u.id)).toBe(2);
    });

    test('idempotencyKey dedups: a replayed key returns the existing row, not a new one (E2)', () => {
        const u = db.createUser('idem@example.com', 'hash');
        const id1 = db.insertSession(u.id, 1000, 4, 6, 'meaning', null, 'key-abc');
        const id2 = db.insertSession(u.id, 9999, 9, 9, 'reading', { x: 1 }, 'key-abc'); // same key → same row
        expect(id2).toBe(id1);
        expect(db.countSessions(u.id)).toBe(1); // no duplicate appended on the replay
        const id3 = db.insertSession(u.id, 2000, 1, 2, null, null, 'key-def'); // different key → inserts
        expect(id3).not.toBe(id1);
        db.insertSession(u.id, 3000, 1, 2, null, null); // NULL key → always inserts (legacy path)
        db.insertSession(u.id, 4000, 1, 2, null, null);
        expect(db.countSessions(u.id)).toBe(4); // 2 distinct keyed + 2 null
        // the same key is independent across users
        const v = db.createUser('idem2@example.com', 'hash');
        const idv = db.insertSession(v.id, 1000, 4, 6, 'meaning', null, 'key-abc');
        expect(idv).not.toBe(id1);
        expect(db.countSessions(v.id)).toBe(1);
    });

    test('sessions cascade-delete with the user', () => {
        const u = db.createUser('c@example.com', 'hash');
        db.insertSession(u.id, 1000, 1, 2, 'meaning', null);
        mem.query('DELETE FROM users WHERE id = ?').run(u.id);
        expect(db.countSessions(u.id)).toBe(0);
    });
});
