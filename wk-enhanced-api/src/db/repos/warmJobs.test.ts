// warm_jobs repo — the append-only warm audit log; ordered most-recent-first.

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
