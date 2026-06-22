// One-time, idempotent data migrations run on sign-in / boot (from cloud.js's pull + selftalk
// afterPull). Carved out of cloud.js so they're independently importable + UNIT-TESTABLE: each is
// async logic over the API + persistence (not DOM/auth glue), and burying them in cloud.js's import
// graph meant they had no test. Both are safe to replay — the server dedups — so a partial run just
// retries on the next sign-in until it completes.

import { account, api, setSyncStatus } from './cloud-core.js';
import { phraseToSentence, cardExamplesPayload } from '../core/index.js';
import { loadCustom } from '../persistence/custom.js';

const CARDEX_MIGRATED_KEY = 'jpverbs_cardex_migrated';

// POST each legacy Self-Talk phrase to the sentence store as a private row; returns the ones that
// FAILED so the caller keeps them in the blob for a later retry. Local + cloud phrases are unioned by
// id (LOCAL wins a dup id — this device's edit is the most recent intent), and POST is idempotent by
// ext_id (the usr-<uuid> ids), so a replay (re-sign-in / another device) is a no-op. Empty input →
// no-op (returns []). Status flips to "✓ phrases migrated" when at least one row landed.
export async function migrateSelftalkPhrases(localPhrases, cloudPhrases) {
  const byId = new Map();
  for (const p of cloudPhrases) if (p && p.id) byId.set(p.id, p);
  for (const p of localPhrases) if (p && p.id) byId.set(p.id, p);   // local wins on a dup id
  if (!byId.size) return [];
  const failed = [];
  for (const p of byId.values()) {
    try { await api('/v1/sentences', { method: 'POST', body: phraseToSentence(p), retry: true }); }   // idempotent by ext_id
    catch (err) { failed.push(p); }
  }
  if (byId.size > failed.length) setSyncStatus('✓ phrases migrated');
  return failed;
}

// One-time-per-device backfill: push every existing custom card's examples into the sentence store so
// it becomes the source for ALL example text (Phase 2.5). pushCardExamples keeps them current on every
// save; this catches cards authored before Phase 2.5 / on another device. Flag-gated so it doesn't
// re-run each sign-in; a partial run is harmless (the localStorage blob still renders any card not yet
// migrated) and is retried next sign-in until all succeed. Idempotent — the PUT replaces wholesale.
export async function migrateCardExamples() {
  if (!account) return;
  if (localStorage.getItem(CARDEX_MIGRATED_KEY)) return;
  const verbs = (loadCustom().verbs || []).filter(v => (v.ex && v.ex.length) || (v.levels && Object.keys(v.levels).length));
  if (!verbs.length) { localStorage.setItem(CARDEX_MIGRATED_KEY, '1'); return; }
  const results = await Promise.allSettled(
    verbs.map(v => api('/v1/sentences/card/' + encodeURIComponent(v.rank), { method: 'PUT', body: cardExamplesPayload(v) })),
  );
  if (results.every(r => r.status === 'fulfilled')) localStorage.setItem(CARDEX_MIGRATED_KEY, '1');
}
