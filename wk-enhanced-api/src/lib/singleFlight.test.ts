// Unit tests for the keyed single-flight primitive. Concurrency is exercised
// deterministically (no sleeps): a manual "deferred" holds `fn` in flight while
// we fire the second caller, so the coalescing window is controlled, not raced.

import { describe, test, expect } from 'bun:test';
import { SingleFlight } from './singleFlight.ts';

// A promise plus its resolve/reject handles, so a test can park work in flight
// and release it on demand.
function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('SingleFlight', () => {
    test('runs fn and returns its value', async () => {
        const sf = new SingleFlight<number>();
        let calls = 0;
        const v = await sf.run('k', async () => {
            calls++;
            return 42;
        });
        expect(v).toBe(42);
        expect(calls).toBe(1);
    });

    test('coalesces concurrent calls for the same key into ONE fn run', async () => {
        const sf = new SingleFlight<string>();
        const d = deferred<string>();
        let calls = 0;
        const fn = () => {
            calls++;
            return d.promise;
        };

        // Both callers arrive while fn is in flight (d not yet resolved).
        const a = sf.run('same', fn);
        const b = sf.run('same', fn);
        expect(sf.has('same')).toBe(true);
        expect(sf.size).toBe(1);

        d.resolve('shared');
        expect(await a).toBe('shared');
        expect(await b).toBe('shared');
        expect(calls).toBe(1); // the herd collapsed to a single run
    });

    test('different keys run independently', async () => {
        const sf = new SingleFlight<string>();
        let calls = 0;
        const [x, y] = await Promise.all([
            sf.run('x', async () => {
                calls++;
                return 'X';
            }),
            sf.run('y', async () => {
                calls++;
                return 'Y';
            }),
        ]);
        expect(x).toBe('X');
        expect(y).toBe('Y');
        expect(calls).toBe(2);
    });

    test('clears the slot after settling (no leak) — coalescing, not memoization', async () => {
        const sf = new SingleFlight<number>();
        let calls = 0;
        const fn = async () => {
            calls++;
            return calls;
        };

        const first = await sf.run('k', fn);
        expect(first).toBe(1);
        expect(sf.size).toBe(0); // slot freed on settle
        expect(sf.has('k')).toBe(false);

        // A later call re-runs fn (the result was never memoized).
        const second = await sf.run('k', fn);
        expect(second).toBe(2);
        expect(calls).toBe(2);
    });

    test('shares a rejection with all current waiters, then frees the slot for a clean retry', async () => {
        const sf = new SingleFlight<string>();
        const d = deferred<string>();
        let calls = 0;
        const failing = () => {
            calls++;
            return d.promise;
        };

        const a = sf.run('k', failing);
        const b = sf.run('k', failing);
        d.reject(new Error('boom'));

        await expect(a).rejects.toThrow('boom');
        await expect(b).rejects.toThrow('boom');
        expect(calls).toBe(1); // one shared failed run
        expect(sf.size).toBe(0); // a poisoned key must not stick around

        // The next call gets a fresh attempt rather than the cached failure.
        const v = await sf.run('k', async () => 'recovered');
        expect(v).toBe('recovered');
    });

    test('a synchronous throw in fn rejects and leaks nothing', async () => {
        const sf = new SingleFlight<number>();
        await expect(
            sf.run('k', () => {
                throw new Error('sync-throw');
            }),
        ).rejects.toThrow('sync-throw');
        expect(sf.size).toBe(0);
        expect(sf.has('k')).toBe(false);
    });

    test('a call that arrives AFTER settlement starts a new run (window closed)', async () => {
        const sf = new SingleFlight<number>();
        let calls = 0;
        const fn = async () => {
            calls++;
            return calls;
        };
        await sf.run('k', fn); // settles, slot freed
        const d = deferred<number>();
        const p = sf.run('k', () => {
            calls++;
            return d.promise;
        });
        expect(sf.size).toBe(1); // a brand-new in-flight run, not the old one
        d.resolve(99);
        expect(await p).toBe(99);
        expect(calls).toBe(2);
    });
});
