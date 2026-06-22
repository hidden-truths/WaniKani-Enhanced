// Sync orchestrator — the GROUP operations over the full set of SyncedBlobs (features/synced-blob.js):
// pull-them-all (server-wins on sign-in / boot), flush-them-all (durable offline replay on reconnect),
// and wire-them-all onto the persistence sync-bus.
//
// Why this exists: cloud.js used to enumerate the blobs imperatively in THREE separate functions
// (pullCloud's pull sequence, flushQueue's queueKey→blob map, initCloud's bus-wiring) — each carrying
// its own copy of the list, with the `minna` blob special-cased in every one. Six blobs arrived from
// several feature streams (progress, custom-verbs, settings, minna, selftalk, songs); the Nth one meant
// editing three call sites that could silently DRIFT — and a drift where a blob is flushed but never
// pulled (so its lastUpdatedAt never bumps) is a real concurrency hazard: the next live push
// false-conflicts (409) forever on that device.
//
// This collapses the three onto ONE injected registry: an ordered list of { blob, busKey } entries.
// Every group operation DERIVES from it, so a new synced blob is registered in exactly one place
// (Open/Closed) and the pull / flush / bus sets can never disagree (DRY). The factory is pure and
// fully dependency-injected — no DOM, no feature-module imports — so it unit-tests in isolation, which
// the cloud.js it was carved out of could not.
//
// Injected collaborators:
//   registry()   -> [{ blob, busKey }]  — a THUNK, evaluated lazily on each use, NOT a captured array:
//                   minnaBlob rides the cloud⇄minna import cycle and isn't bound at cloud.js eval time,
//                   so the list must be read at call time. busKey is the sync-bus slot the blob's
//                   debounced scheduler wires onto (or null — minna, whose saveMinna schedules directly).
//   queue        -> the durable offline write-queue (net/sync-queue.js): { flush(accountId, onFlushed) }.
//   sync         -> the persistence sync-bus (sync-bus.js): the mutable { <busKey>: scheduleFn } object.
//   getAccount   -> () => the current account ({ id } | null); read LIVE on every call, never captured.

export function createSyncOrchestrator({ registry, queue, sync, getAccount }) {
  // Pull every registered blob (server-wins-on-login + fresh-account seed), in registry order.
  // RESILIENT BY DESIGN: each blob is isolated in its own try/catch, so one blob's failure — a network
  // drop mid-chain, or a throwing afterPull side-effect (rebuildData / a migration / a re-render) — can
  // never abort the blobs that come after it. (synced-blob's pull() already swallows the fetch error via
  // onOffline, but it awaits afterPull UNGUARDED, unlike reconcile(); this is the orchestration-level
  // backstop that makes the whole group's sign-in resilient regardless.) Returns the count that pulled
  // without throwing; never rejects.
  async function pullAll() {
    let pulled = 0;
    for (const { blob } of registry()) {
      try { await blob.pull(); pulled++; }
      catch (e) { /* isolate: a single blob's failure must not block the rest of the sync */ }
    }
    return pulled;
  }

  // Flush the durable offline write-queue for the current account (idempotent replays), then bump each
  // owning blob's lastUpdatedAt from the server's replay response so the next live push doesn't
  // false-conflict (409). The queueKey→blob map is derived from the SAME registry, so every blob that
  // can enqueue a write can also be bumped after that write replays — they can't disagree. No-op
  // (returns 0) when signed out: queued writes are per-account and the queue keys nothing else.
  async function flushAll() {
    const account = getAccount();
    if (!account) return 0;
    const byQueueKey = {};
    for (const { blob } of registry()) byQueueKey[blob.queueKey] = blob;
    return queue.flush(account.id, (key, r) => {
      const b = byQueueKey[key];
      if (b && r && typeof r.updatedAt === 'number') b._setLastUpdatedAt(r.updatedAt);
    });
  }

  // Wire each bus-keyed blob's debounced scheduler onto the persistence sync-bus, so a persistence
  // save() (store / custom / settings / selftalk / songs) schedules that blob's push. Entries with
  // busKey:null (minna — saveMinna calls minnaBlob.schedule directly) are skipped. Idempotent.
  function wireBus() {
    for (const { blob, busKey } of registry()) if (busKey) sync[busKey] = blob.schedule;
  }

  return { pullAll, flushAll, wireBus };
}
