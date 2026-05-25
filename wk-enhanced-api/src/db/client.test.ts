// DB repo CRUD against an in-memory SQLite. Verifies schema applies cleanly,
// upserts overwrite payload + count, serve counter increments correctly,
// and the warm-job audit log orders most-recent-first.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { openDb, _useDbForTesting } from './client.ts';
import * as db from './client.ts';

let mem: ReturnType<typeof openDb>;

beforeEach(() => {
    mem = openDb(':memory:');
    _useDbForTesting(mem);
});

afterEach(() => {
    _useDbForTesting(null);
    mem.close();
});

describe('vocab_examples CRUD', () => {
    test('upsert + get round-trip preserves payload', () => {
        const payload = { word: 'foo', examples: [{ id: 'a' }], fallbackImages: [] };
        db.upsertVocab('foo', payload, 1);
        const got = db.getVocab('foo');
        expect(got).not.toBeNull();
        expect(got!.payload).toEqual(payload);
        expect(got!.exampleCount).toBe(1);
        expect(got!.serveCount).toBe(0);
        expect(got!.lastServedAt).toBeNull();
    });

    test('upsert overwrites payload + example_count', () => {
        db.upsertVocab('foo', { v: 1 }, 5);
        db.upsertVocab('foo', { v: 2 }, 10);
        const got = db.getVocab('foo');
        expect(got!.payload).toEqual({ v: 2 });
        expect(got!.exampleCount).toBe(10);
    });

    test('upsert does NOT reset serve_count (warm preserves serve history)', () => {
        db.upsertVocab('foo', { v: 1 }, 1);
        db.recordVocabServe('foo');
        db.recordVocabServe('foo');
        db.upsertVocab('foo', { v: 2 }, 1);
        const got = db.getVocab('foo');
        expect(got!.serveCount).toBe(2); // preserved across re-warm
    });

    test('getVocab returns null for missing word', () => {
        expect(db.getVocab('nonexistent')).toBeNull();
    });

    test('recordVocabServe increments serve_count and updates last_served_at', () => {
        db.upsertVocab('foo', { v: 1 }, 1);
        const before = db.getVocab('foo')!;
        db.recordVocabServe('foo');
        const after = db.getVocab('foo')!;
        expect(after.serveCount).toBe(before.serveCount + 1);
        expect(after.lastServedAt).not.toBeNull();
        expect(after.lastServedAt!).toBeGreaterThanOrEqual(before.fetchedAt);
    });

    test('countVocabRows reflects current row count', () => {
        expect(db.countVocabRows()).toBe(0);
        db.upsertVocab('a', {}, 1);
        db.upsertVocab('b', {}, 1);
        expect(db.countVocabRows()).toBe(2);
        // Upserting an existing word doesn't grow the count.
        db.upsertVocab('a', {}, 2);
        expect(db.countVocabRows()).toBe(2);
    });
});

describe('index_meta CRUD', () => {
    test('returns null when never written', () => {
        expect(db.getIndexMeta()).toBeNull();
    });

    test('upsert + get round-trips decks', () => {
        const decks = {
            fate_zero: { title: 'Fate Zero', category: 'anime' },
            kill_la_kill: { title: 'Kill la Kill', category: 'anime' },
        };
        db.upsertIndexMeta(decks);
        const got = db.getIndexMeta();
        expect(got).not.toBeNull();
        expect(got!.decks).toEqual(decks);
        expect(got!.fetchedAt).toBeGreaterThan(0);
    });

    test('upsert replaces the singleton row entirely', () => {
        db.upsertIndexMeta({ a: { title: 'A', category: 'anime' } });
        db.upsertIndexMeta({ b: { title: 'B', category: 'drama' } });
        const got = db.getIndexMeta()!;
        expect(Object.keys(got.decks)).toEqual(['b']); // 'a' is gone
    });
});

describe('warm_jobs audit log', () => {
    test('createWarmJob + finishWarmJob round-trip', () => {
        const id = db.createWarmJob('word', 'foo');
        expect(id).toBeGreaterThan(0);
        db.finishWarmJob(id, 1, 0, null);
        const got = db.getLastWarmJob();
        expect(got).not.toBeNull();
        expect(got!.id).toBe(id);
        expect(got!.scope).toBe('word');
        expect(got!.target).toBe('foo');
        expect(got!.wordsProcessed).toBe(1);
        expect(got!.wordsFailed).toBe(0);
        expect(got!.error).toBeNull();
        expect(got!.finishedAt).not.toBeNull();
    });

    test('records error on failure', () => {
        const id = db.createWarmJob('word', 'baz');
        db.finishWarmJob(id, 0, 1, 'IK timeout');
        const got = db.getLastWarmJob()!;
        expect(got.wordsFailed).toBe(1);
        expect(got.error).toBe('IK timeout');
    });

    test('getLastWarmJob returns the most recent', () => {
        const a = db.createWarmJob('word', 'a');
        const b = db.createWarmJob('all', null);
        db.finishWarmJob(a, 1, 0, null);
        db.finishWarmJob(b, 50, 2, null);
        const got = db.getLastWarmJob()!;
        expect(got.id).toBe(b);
        expect(got.scope).toBe('all');
        expect(got.target).toBeNull();
    });

    test('listWarmJobs returns newest-first up to limit', () => {
        const ids = [
            db.createWarmJob('word', 'one'),
            db.createWarmJob('word', 'two'),
            db.createWarmJob('word', 'three'),
        ];
        ids.forEach((id) => db.finishWarmJob(id, 1, 0, null));
        const all = db.listWarmJobs(10);
        expect(all.map((j) => j.target)).toEqual(['three', 'two', 'one']);
        // Limit honored.
        const top1 = db.listWarmJobs(1);
        expect(top1).toHaveLength(1);
        expect(top1[0].target).toBe('three');
    });

    test('listWarmJobs returns empty array when there are no jobs', () => {
        expect(db.listWarmJobs(10)).toEqual([]);
    });
});
