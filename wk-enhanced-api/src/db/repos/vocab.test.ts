// vocab_examples repo. Verifies the schema applies, upserts overwrite payload +
// count, and the serve counter increments without being reset by a re-warm.

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
