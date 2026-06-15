// minna_recordings repo — per-user voice takes: owner-scoped reads/deletes, prune-to-N,
// and the per-lesson practice-history aggregate.

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

describe('minna_recordings (record-and-compare)', () => {
    // Insert a take with an explicit createdAt so ordering tests are deterministic.
    const add = (userId: number, lesson: number, itemKey: string, createdAt: number) =>
        db.insertRecording(userId, lesson, itemKey, `rec/${userId}/${itemKey}/${createdAt}.webm`, 'audio/webm', 1500, createdAt);

    test('insert + list returns a lesson’s takes newest-first', () => {
        const u = db.createUser('r@example.com', 'hash');
        add(u.id, 23, 'mnn:23:0', 1000);
        add(u.id, 23, 'mnn:23:0', 3000);
        add(u.id, 23, 'mnn:23:1', 2000);
        const list = db.listRecordings(u.id, 23);
        expect(list.map((r) => r.createdAt)).toEqual([3000, 2000, 1000]);
        expect(list[0]!.contentType).toBe('audio/webm');
    });

    test('list is scoped per (user, lesson)', () => {
        const u = db.createUser('a@example.com', 'hash');
        const v = db.createUser('b@example.com', 'hash');
        add(u.id, 23, 'mnn:23:0', 1000);
        add(u.id, 24, 'mnn:24:0', 1000);
        add(v.id, 23, 'mnn:23:0', 1000);
        expect(db.listRecordings(u.id, 23)).toHaveLength(1);
        expect(db.listRecordings(u.id, 24)).toHaveLength(1);
        expect(db.listRecordings(v.id, 23)).toHaveLength(1);
    });

    test('getRecording is owner-scoped (a guessed id from another account 404s)', () => {
        const u = db.createUser('o@example.com', 'hash');
        const v = db.createUser('p@example.com', 'hash');
        const id = add(u.id, 23, 'mnn:23:0', 1000);
        expect(db.getRecording(u.id, id)).not.toBeNull();
        expect(db.getRecording(v.id, id)).toBeNull();
    });

    test('deleteRecording removes only the owner’s row and returns it', () => {
        const u = db.createUser('d@example.com', 'hash');
        const v = db.createUser('e@example.com', 'hash');
        const id = add(u.id, 23, 'mnn:23:0', 1000);
        expect(db.deleteRecording(v.id, id)).toBeNull(); // not the owner → no-op
        const row = db.deleteRecording(u.id, id);
        expect(row).not.toBeNull();
        expect(row!.storageKey).toContain('mnn:23:0');
        expect(db.getRecording(u.id, id)).toBeNull();
    });

    test('pruneRecordings keeps the newest N of an item and returns the dropped rows', () => {
        const u = db.createUser('k@example.com', 'hash');
        for (const t of [1000, 2000, 3000, 4000, 5000]) add(u.id, 23, 'mnn:23:0', t);
        add(u.id, 23, 'mnn:23:1', 9000); // a different item — must be untouched
        const dropped = db.pruneRecordings(u.id, 23, 'mnn:23:0', 3);
        expect(dropped.map((r) => r.createdAt).sort()).toEqual([1000, 2000]);
        const remaining = db.listRecordings(u.id, 23).filter((r) => r.itemKey === 'mnn:23:0');
        expect(remaining.map((r) => r.createdAt)).toEqual([5000, 4000, 3000]);
        // the other item is left alone
        expect(db.listRecordings(u.id, 23).filter((r) => r.itemKey === 'mnn:23:1')).toHaveLength(1);
    });

    test('pruneRecordings is a no-op when under the cap', () => {
        const u = db.createUser('n@example.com', 'hash');
        add(u.id, 23, 'mnn:23:0', 1000);
        add(u.id, 23, 'mnn:23:0', 2000);
        expect(db.pruneRecordings(u.id, 23, 'mnn:23:0', 3)).toEqual([]);
        expect(db.listRecordings(u.id, 23)).toHaveLength(2);
    });

    test('recordings cascade-delete with the user', () => {
        const u = db.createUser('cascade@example.com', 'hash');
        add(u.id, 23, 'mnn:23:0', 1000);
        mem.query('DELETE FROM users WHERE id = ?').run(u.id);
        expect(db.listRecordings(u.id, 23)).toHaveLength(0);
    });

    test('recordingSummary aggregates per lesson (distinct items, take counts, last time)', () => {
        const u = db.createUser('hist@example.com', 'hash');
        // L23: two items, three takes total; L24: one item, one take.
        add(u.id, 23, 'mnn:23:0', 1000);
        add(u.id, 23, 'mnn:23:0', 5000); // same item, newer
        add(u.id, 23, 'mnn:23:1', 3000);
        add(u.id, 24, 'mnn:24:0', 2000);
        const summary = db.recordingSummary(u.id);
        expect(summary).toEqual([
            { lesson: 23, items: 2, takes: 3, lastCreatedAt: 5000 },
            { lesson: 24, items: 1, takes: 1, lastCreatedAt: 2000 },
        ]);
    });

    test('recordingSummary is owner-scoped and empty when nothing recorded', () => {
        const u = db.createUser('empty@example.com', 'hash');
        const v = db.createUser('other@example.com', 'hash');
        add(v.id, 23, 'mnn:23:0', 1000); // another user's take must not leak in
        expect(db.recordingSummary(u.id)).toEqual([]);
        expect(db.recordingSummary(v.id)).toEqual([{ lesson: 23, items: 1, takes: 1, lastCreatedAt: 1000 }]);
    });
});
