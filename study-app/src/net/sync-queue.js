// Durable offline write-queue — a localStorage-backed FIFO of pending IDEMPOTENT writes
// (the full-replace progress PUTs). When a SyncedBlob push fails after the transport's
// retries (offline / persistent 5xx), it enqueues here; flush() replays on reconnect /
// boot / sign-in so a change made while offline is never silently lost.
//
// ONLY idempotent writes belong here. POST /v1/sessions and the binary recording upload are
// non-idempotent (a replay would duplicate a row) and are deliberately NOT queued.
//
// Dedup by `key` (e.g. 'progress:verbs'): a newer write for the same blob REPLACES the older
// — full-replace PUTs make last-wins correct. Entries are tagged with the accountId so flush
// only replays the current account's, and clear() drops everything on sign-out.

import { api } from './transport.js';

const QUEUE_KEY = 'jpverbs_sync_queue';

function load() {
  try {
    const a = JSON.parse(localStorage.getItem(QUEUE_KEY));
    return Array.isArray(a) ? a : [];
  } catch (e) {
    return [];
  }
}
function save(entries) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(entries)); } catch (e) {}
}

// Enqueue (or replace) a pending write: { key, path, method, body, accountId }.
// Same-key dedup keeps the newest (full-replace semantics).
export function enqueue(entry) {
  const entries = load().filter((e) => e.key !== entry.key);
  entries.push({
    key: entry.key,
    path: entry.path,
    method: entry.method,
    body: entry.body,
    accountId: entry.accountId,
  });
  save(entries);
}

// Remove a queued write by key (e.g. after a live push for the same blob succeeds).
export function remove(key) {
  save(load().filter((e) => e.key !== key));
}

export function clear() { save([]); }
export function peek() { return load(); }
export function size() { return load().length; }

// Replay every queued write for `accountId`. Per entry:
//   success → drop it + onFlushed(key, response) (lets the owning blob bump lastUpdatedAt);
//   409     → drop it (stale — the blob's next pull reconciles server-wins);
//   other   → leave it queued (still offline / 5xx after the transport's retries).
// Entries for other accounts are left intact. Returns the count flushed OK.
export async function flush(accountId, onFlushed) {
  let flushed = 0;
  for (const e of load()) {
    if (e.accountId !== accountId) continue;
    try {
      const r = await api(e.path, { method: e.method, body: e.body, retry: true });
      remove(e.key);
      flushed++;
      if (onFlushed) { try { onFlushed(e.key, r); } catch (err) {} }
    } catch (err) {
      if (err && err.status === 409) remove(e.key);   // stale; the next pull reconciles
      // else transient/offline → keep for the next flush
    }
  }
  return flushed;
}
