// WaniKani sync engine — pulls the full data suite (user / summary / subjects /
// assignments / review statistics / level progressions) into the IndexedDB cache.
//
// First sync is FULL (~30 requests, well inside the 60/min limit; subjects dominate at
// ~10 pages of 1000). Every later sync is INCREMENTAL: each collection remembers the
// envelope's data_updated_at as its `updated_after` cursor, so a routine re-open costs
// 4-6 requests that mostly return zero rows. Cursors advance only after a collection
// lands in IDB, so an interrupted sync just re-fetches that collection's tail.
import { wkFetch, wkPaginate } from './api.js';
import { idbPutAll, idbGetAll, idbGetMeta, idbSetMeta } from './idb.js';
import { slimSubject, slimAssignment, slimStat, slimProgression } from '../../core/index.js';

const COLLECTIONS = [
  { key: 'subjects', path: '/subjects', store: 'subjects', slim: slimSubject, label: 'subjects' },
  { key: 'assignments', path: '/assignments', store: 'assignments', slim: slimAssignment, label: 'assignments' },
  { key: 'reviewStats', path: '/review_statistics', store: 'stats', slim: slimStat, label: 'review stats' },
];

// Slim the /summary report to what the dashboard shows: lessons available now +
// the raw hourly review buckets (subject counts only).
function slimSummary(raw) {
  const d = raw.data || {};
  const lessons = (d.lessons || []).reduce((n, b) => n + ((b.subject_ids || []).length), 0);
  return { lessons, nextReviewsAt: d.next_reviews_at ? Date.parse(d.next_reviews_at) : null };
}

// Read the whole cache into memory. Returns null when the cache has never been filled
// (no lastSyncAt) so the caller can distinguish "fresh install" from "empty account".
export async function loadWkCache() {
  const lastSyncAt = await idbGetMeta('lastSyncAt');
  if (!lastSyncAt) return null;
  const [subjects, assignments, stats, user, summary, progressions] = await Promise.all([
    idbGetAll('subjects'), idbGetAll('assignments'), idbGetAll('stats'),
    idbGetMeta('user'), idbGetMeta('summary'), idbGetMeta('progressions'),
  ]);
  return { subjects, assignments, stats, user: user || null, summary: summary || null, progressions: progressions || [], lastSyncAt };
}

// Run one sync (full or incremental — the cursors decide). `onProgress(msg)` feeds the
// live status line. Returns the same shape as loadWkCache().
export async function syncWk(token, onProgress) {
  const report = (msg) => { if (onProgress) onProgress(msg); };

  report('profile…');
  const user = (await wkFetch('/user', token)).data;
  const summary = slimSummary(await wkFetch('/summary', token));

  const cursors = (await idbGetMeta('cursors')) || {};
  for (const col of COLLECTIONS) {
    const params = cursors[col.key] ? { updated_after: cursors[col.key] } : {};
    report(col.label + '…');
    const { data, dataUpdatedAt } = await wkPaginate(col.path, token, params, (got, total) => {
      if (total > 600) report(`${col.label} ${got.toLocaleString()} / ${total.toLocaleString()}`);   // only multi-page pulls get a counter
    });
    if (data.length) await idbPutAll(col.store, data.map(col.slim));
    if (dataUpdatedAt) cursors[col.key] = dataUpdatedAt;
    await idbSetMeta('cursors', cursors);
  }

  report('level history…');
  const progressions = (await wkPaginate('/level_progressions', token)).data.map(slimProgression);

  const lastSyncAt = Date.now();
  await Promise.all([
    idbSetMeta('user', user),
    idbSetMeta('summary', summary),
    idbSetMeta('progressions', progressions),
    idbSetMeta('lastSyncAt', lastSyncAt),
  ]);
  return loadWkCache();
}

// Validate a pasted token by fetching /user. Returns the user payload; throws the
// wkFetch error (code 'unauthorized' on a bad token) for the gate to display.
export async function verifyToken(token) {
  return (await wkFetch('/user', token)).data;
}
