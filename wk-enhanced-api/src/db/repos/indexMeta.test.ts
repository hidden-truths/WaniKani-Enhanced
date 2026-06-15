// index_meta repo — the singleton IK deck-map row (id=1). Upsert replaces it wholesale.

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
