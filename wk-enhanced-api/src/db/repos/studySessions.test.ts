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

    test('sessions cascade-delete with the user', () => {
        const u = db.createUser('c@example.com', 'hash');
        db.insertSession(u.id, 1000, 1, 2, 'meaning', null);
        mem.query('DELETE FROM users WHERE id = ?').run(u.id);
        expect(db.countSessions(u.id)).toBe(0);
    });
});
