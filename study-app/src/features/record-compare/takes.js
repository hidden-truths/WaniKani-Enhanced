// Takes: the per-scope take cache + the credentialed upload/list/delete. Split out of the
// record-and-compare engine (C1.3). recCache + onTakeSaved are LOCAL singletons (no other module
// mutates them). DEAD-END preserved: the server's `lesson` query param is the opaque scope
// partition's wire name (Minna passes a lesson number, Self-Talk a reserved id) — kept as-is.
import { account, api, setSyncStatus } from '../cloud-core.js';
import { clampKeep } from '../../core/index.js';
import { settings } from '../../settings-store.js';
// Forward dep on the not-yet-peeled view code (resetControl → view.js C1.6). Runtime-only.
import { resetControl } from './view.js';

// ---------- take cache (per scope, fetched once) ----------
// recCache[scope] = array of takes {id,lesson,itemKey,durationMs,createdAt} newest-first.
const recCache = {};
export async function loadRecordings(scope) {
  if (!account) { recCache[scope] = []; return []; }
  try {
    const r = await api('/v1/audio/recordings?lesson=' + scope);   // server param name is `lesson` (opaque partition)
    recCache[scope] = (r && r.recordings) || [];
  } catch (e) { recCache[scope] = recCache[scope] || []; }
  return recCache[scope];
}
export function takesFor(scope, itemKey) {
  return (recCache[scope] || []).filter(t => t.itemKey === itemKey);
}
// Newest take id for an item (or null) — used by the caller to let a unified play button offer
// the user's own recording as a 'user'-kind variant. Reads the per-scope take cache that
// loadRecordings already populated on render.
export function newestTakeIdForItem(scope, itemKey) {
  const takes = takesFor(scope, itemKey);
  return takes.length ? takes[0].id : null;
}
// Same, but reading scope/itemKey off a control's dataset (used by the compare player + waveform).
export function newestTakeId(control) {
  const takes = takesFor(Number(control.dataset.scope), control.dataset.itemkey);
  return takes.length ? takes[0].id : null;
}
// Replace one item's takes in the cache (after upload/delete) without a refetch.
export function setTakes(scope, itemKey, takes) {
  const others = (recCache[scope] || []).filter(t => t.itemKey !== itemKey);
  recCache[scope] = others.concat(takes).sort((a, b) => b.createdAt - a.createdAt);
}

// ---------- upload / delete (credentialed) ----------
// The recording upload goes through the resilient transport (api, {retry:true}) — a binary POST via
// opts.rawBody (the blob sent verbatim with its Content-Type, NOT JSON). It carries a client
// idempotency key (?idem=) so the SERVER dedups a replay (E2) — which is what makes the transport's
// retry/backoff safe (a retried upload returns the prior take, never a duplicate). The multi-MB blob
// is deliberately NOT offline-queued (localStorage is the wrong store for it); transient 5xx/network
// blips are covered by the in-session retries, a persistent failure surfaces below. list/delete use api() too.
export async function uploadTake(control, blob, durationMs) {
  const scope = Number(control.dataset.scope), itemKey = control.dataset.itemkey;
  const keep = clampKeep(settings.recordingsKeep);
  const ct = blob.type || 'audio/webm';
  const idem = crypto.randomUUID();   // dedup key — a replay of THIS take returns the prior row, no dup
  setSyncStatus('saving…');
  try {
    const qs = `?lesson=${scope}&itemKey=${encodeURIComponent(itemKey)}&durationMs=${Math.round(durationMs)}&keep=${keep}&idem=${idem}`;
    const data = await api('/v1/audio/recordings' + qs, { method: 'POST', rawBody: blob, contentType: ct, retry: true });
    setTakes(scope, itemKey, (data && data.takes) || []);
    setSyncStatus('✓ recording saved');
    if (onTakeSaved) { try { onTakeSaved(scope, itemKey); } catch (e) {} }   // notify the host (e.g. Self-Talk practice signal)
  } catch (e) {
    setSyncStatus('⚠ could not save recording');
  }
  resetControl(control);
}

export async function deleteTake(control, id) {
  const scope = Number(control.dataset.scope), itemKey = control.dataset.itemkey;
  try { await api('/v1/audio/recordings/' + id, { method: 'DELETE' }); } catch (e) {}
  setTakes(scope, itemKey, takesFor(scope, itemKey).filter(t => t.id !== id));
  resetControl(control);
}

// Optional host hook fired after a take is successfully saved (scope, itemKey) — lets a consumer
// record a practice signal (Self-Talk's "practiced today"/streak) without coupling this engine to it.
let onTakeSaved = null;
export function setOnTakeSaved(fn) { onTakeSaved = fn || null; }
