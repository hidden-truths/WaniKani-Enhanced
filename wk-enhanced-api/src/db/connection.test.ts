// Connection-layer pragmas. These are load-bearing for correctness (foreign_keys → the
// ON DELETE CASCADE cleanup the whole account model relies on) and for resilience under
// concurrency (busy_timeout → two concurrent write transactions serialize instead of the
// second throwing SQLITE_BUSY). Pinned here so a future edit to openDb can't silently drop one.

import { describe, test, expect, afterEach } from 'bun:test';
import { openDb } from './connection.ts';

let mem: ReturnType<typeof openDb> | null = null;

afterEach(() => {
    mem?.close();
    mem = null;
});

// `PRAGMA <name>` returns a single-column row; the column name isn't always `<name>` (e.g.
// `PRAGMA busy_timeout` returns a column called `timeout`), so read the first/only value.
function pragma(db: ReturnType<typeof openDb>, query: string): number {
    return Object.values(db.query(`PRAGMA ${query}`).get() as Record<string, number>)[0];
}

describe('openDb pragmas', () => {
    test('sets busy_timeout to 5000ms so concurrent writers wait, not throw', () => {
        mem = openDb(':memory:');
        expect(pragma(mem, 'busy_timeout')).toBe(5000);
    });

    test('enables foreign_keys (the ON DELETE CASCADE account cleanup depends on it)', () => {
        mem = openDb(':memory:');
        expect(pragma(mem, 'foreign_keys')).toBe(1);
    });
});
