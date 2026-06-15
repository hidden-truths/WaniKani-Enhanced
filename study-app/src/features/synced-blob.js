// SyncedBlob — the one abstraction behind every cloud-synced "progress blob" (verbs,
// custom-verbs, settings, selftalk, minna). Each blob is a full-replace JSON document PUT to
// /v1/progress/{appKey}; this collapses the five copy-pasted schedule/push/pull trios into one
// place and owns: the debounce, the saving/synced/offline status, the durable offline-queue
// fallback on failure, server-wins-on-pull, fresh-account seeding, and (B4) optimistic
// concurrency via baseUpdatedAt + a 409 reconcile.
//
//   read()              -> the local document to PUT (e.g. () => state.store)
//   apply(data)         -> server-wins: write local state from the server's `data`, NO re-push.
//                          MUST guard a null/empty `data` itself (it's called even when the
//                          server has nothing). RETURN true if the data was usable — then pull
//                          records lastUpdatedAt + runs afterPull; false falls through to the
//                          fresh-account seed.
//   afterPull(data,opt) -> optional side-effects after a successful apply (rebuildData,
//                          applyFurigana+…, the Self-Talk migration). `opt.reconcile` is true
//                          when called from a 409 reconcile (Self-Talk skips its re-push then).
//   shouldSeed()        -> optional: when the server has nothing, push local to seed? (default yes)
//   onOffline()         -> optional: pull-failure hook (progress shows '⚠ offline'; others quiet)
//   merge(local,server) -> optional: 409 conflict resolver. When present, a conflict UNIONS the
//                          local + server copies (no data loss) and re-pushes, instead of the
//                          server-wins MVP. Pure; the per-blob strategies live in core/merge.js.
//   debounceMs          -> coalesce window (default 1200, matching the old schedulers)

import { account, api, setSyncStatus } from './cloud-core.js';
import * as queue from '../net/sync-queue.js';

export function createSyncedBlob({ appKey, read, apply, afterPull, shouldSeed, onOffline, merge, debounceMs = 1200 }) {
  const path = '/v1/progress/' + appKey;
  const queueKey = 'progress:' + appKey;
  let timer = null;
  let lastUpdatedAt = null;   // server updated_at for our last sync; sent as baseUpdatedAt (B4)
  let mergingReconcile = false;   // guards the merge re-push to a single round (E1)

  // Debounced push — coalesces the rapid save() calls during a session into one PUT.
  function schedule() {
    if (!account) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(push, debounceMs);
  }

  async function push() {
    if (!account) return;
    setSyncStatus('saving…');
    const data = read();
    // Send baseUpdatedAt only once we know the server's version (B4); the very first write omits
    // it → the server's legacy unconditional path (no client is forced to upgrade).
    const body = lastUpdatedAt != null ? { data, baseUpdatedAt: lastUpdatedAt } : { data };
    try {
      const r = await api(path, { method: 'PUT', body });
      if (r && typeof r.updatedAt === 'number') lastUpdatedAt = r.updatedAt;
      queue.remove(queueKey);          // a live push supersedes any older offline copy
      setSyncStatus('✓ synced');
    } catch (err) {
      if (err && err.status === 409) { await reconcile(err); return; }   // B4
      // Offline / persistent failure: enqueue an UNCONDITIONAL replay (no baseUpdatedAt) so the
      // offline change is delivered on reconnect rather than dropped — durability over concurrency
      // for the offline path. Dedup by key keeps the newest local state.
      queue.enqueue({ key: queueKey, path, method: 'PUT', body: { data }, accountId: account.id });
      setSyncStatus('⚠ offline');
    }
  }

  // B4 optimistic-concurrency conflict: the server row moved since our lastUpdatedAt. If the blob
  // supplied a merge() strategy (E1), UNION local + server so NEITHER device's offline change is
  // lost, apply the union, and re-push it with the server's updatedAt as the new base — guarded to a
  // SINGLE merge round (a second 409 during that re-push falls through to server-wins, so a device
  // writing on every beat can't loop us). Without merge() (e.g. settings, where last-writer is fine)
  // we keep the server-wins MVP: adopt the server copy so the other device's change is preserved, not
  // silently clobbered. afterPull runs in {reconcile:true} mode (Self-Talk skips its practice re-push
  // then; our own merge-push below is the single PUT for the merged state).
  async function reconcile(err) {
    const cur = err && err.body;
    if (cur && typeof cur.updatedAt === 'number') lastUpdatedAt = cur.updatedAt;
    const serverData = cur && cur.data;
    if (serverData == null) { setSyncStatus('✓ synced'); return; }

    if (merge && !mergingReconcile) {
      const merged = merge(read(), serverData);
      if (apply(merged)) {
        if (afterPull) { try { await afterPull(merged, { reconcile: true }); } catch (e) {} }
        mergingReconcile = true;
        try { await push(); } finally { mergingReconcile = false; }   // re-push the union (push sets status/updatedAt)
        return;
      }
    }
    // No merge() (or merge produced nothing usable / already merged once this chain): server-wins.
    if (apply(serverData) && afterPull) {
      try { await afterPull(serverData, { reconcile: true }); } catch (e) {}
    }
    setSyncStatus('✓ synced');
  }

  // Pull after sign-in / boot. Server wins when it has usable data; a fresh account seeds the
  // cloud from local. apply() is called even with null data (it guards internally) so a blob whose
  // afterPull must always run (Self-Talk's migration) can return true unconditionally.
  async function pull() {
    let data = null;
    try {
      const r = await api(path);
      data = r ? r.data : null;
      if (r && typeof r.updatedAt === 'number') lastUpdatedAt = r.updatedAt;
    } catch (err) {
      if (onOffline) onOffline();
      return;
    }
    if (apply(data)) {
      if (afterPull) await afterPull(data, {});
    } else if (!shouldSeed || shouldSeed()) {
      await push();   // fresh account — seed the cloud from local
    }
  }

  return {
    schedule, push, pull,
    appKey, queueKey,
    get lastUpdatedAt() { return lastUpdatedAt; },
    _setLastUpdatedAt(v) { lastUpdatedAt = v; },   // flush's onFlushed bumps this after a queued replay
  };
}
