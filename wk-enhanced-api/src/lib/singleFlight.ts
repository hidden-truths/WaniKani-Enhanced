// Keyed single-flight (a.k.a. request coalescing): while a Promise for `key`
// is in flight, concurrent callers for the SAME key share that one Promise
// instead of each starting their own work. The classic use is collapsing a
// thundering herd of identical cache-misses into a single upstream call.
//
// This is a deliberately generic primitive — no I/O, no domain knowledge — so
// it backs any "do this expensive thing at most once concurrently per key"
// need. Today:
//   • services/mediaCache.ts coalesces concurrent cold-fills of the same media
//     key (two users hitting 食べる at once → one IK download, not two).
//   • warm/pipeline.ts's bespoke `ddgInFlight` Set is a coarser, hand-rolled
//     instance of this same idea (it dedupes a whole background DDG task per
//     word, not a single keyed result). Left as-is for now; it could adopt this
//     class later if we want one mechanism.
//
// Scope: per-process (a module/instance-level Map). Correct for the single-
// droplet deploy — the same caveat as `ddgInFlight` / `lastIkCallAt` in
// services/ik.ts. A multi-process world would need a shared coordinator (e.g.
// a Redis lock) for cross-process coalescing; the call sites already tolerate
// the occasional duplicate upstream call (idempotent, content-addressed writes)
// so that upgrade is optional, not load-bearing.
//
// Coalescing, NOT memoization: the in-flight entry is removed the instant the
// Promise SETTLES (resolve OR reject). So a later call re-runs `fn` (we cache
// the in-flight Promise, never the result), and a rejection is shared by the
// current waiters and then forgotten — the next call gets a clean retry rather
// than a permanently-poisoned key.

export class SingleFlight<T> {
    private readonly inflight = new Map<string, Promise<T>>();

    // Run `fn` for `key`, or join the in-flight run if one already exists. Every
    // caller that arrives while `fn` is running receives the SAME promise, and
    // thus the identical resolved value (or rejection).
    run(key: string, fn: () => Promise<T>): Promise<T> {
        const existing = this.inflight.get(key);
        if (existing) return existing;

        // `fn` may throw synchronously (before returning a promise). Nothing was
        // ever registered in that case, so just surface it as a rejection — no
        // map entry to clean up.
        let started: Promise<T>;
        try {
            started = fn();
        } catch (err) {
            return Promise.reject(err);
        }

        // Register the tracked promise SYNCHRONOUSLY (before any await inside
        // `fn` can resume) so a truly-concurrent second caller observes it. The
        // cleanup is identity-guarded: it only clears the slot if it still holds
        // THIS promise, so it can never delete a successor run for the same key.
        const tracked = started.finally(() => {
            if (this.inflight.get(key) === tracked) this.inflight.delete(key);
        });
        this.inflight.set(key, tracked);
        return tracked;
    }

    // Whether `key` currently has an in-flight run.
    has(key: string): boolean {
        return this.inflight.has(key);
    }

    // Number of keys currently in flight. Primarily for tests asserting the map
    // does not leak entries after settlement.
    get size(): number {
        return this.inflight.size;
    }
}
