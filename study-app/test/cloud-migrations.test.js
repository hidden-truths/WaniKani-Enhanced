// Tests for the sign-in/boot data migrations (src/features/cloud-migrations.js), extracted from
// cloud.js so they're testable. cloud-core (account/api/setSyncStatus) + persistence/custom
// (loadCustom) are mocked; the REAL pure core helpers (phraseToSentence / cardExamplesPayload) build
// the request bodies, so the assertions exercise the genuine payload shapes.
import { test, expect, beforeEach, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ account: { id: 1 } }));
vi.mock('../src/features/cloud-core.js', () => ({
  get account() { return ctx.account; },
  api: vi.fn(),
  setSyncStatus: vi.fn(),
}));
vi.mock('../src/persistence/custom.js', () => ({ loadCustom: vi.fn() }));

import { api, setSyncStatus } from '../src/features/cloud-core.js';
import { loadCustom } from '../src/persistence/custom.js';
import { migrateSelftalkPhrases, migrateCardExamples } from '../src/features/cloud-migrations.js';

const CARDEX_KEY = 'jpverbs_cardex_migrated';

// The harness localStorage is a partial shim (no removeItem/clear), so back it with a real Map for
// these tests — the migrations only touch getItem/setItem.
const _ls = new Map();
vi.stubGlobal('localStorage', {
  getItem: (k) => (_ls.has(k) ? _ls.get(k) : null),
  setItem: (k, v) => { _ls.set(k, String(v)); },
  removeItem: (k) => { _ls.delete(k); },
  clear: () => { _ls.clear(); },
});

beforeEach(() => {
  ctx.account = { id: 1 };
  vi.resetAllMocks();
  loadCustom.mockReturnValue({ seq: 100, verbs: [] });   // default; tests override
  _ls.clear();
});

// ───────────────────────── migrateSelftalkPhrases ─────────────────────────

test('migrateSelftalkPhrases with no phrases is a no-op returning []', async () => {
  await expect(migrateSelftalkPhrases([], [])).resolves.toEqual([]);
  expect(api).not.toHaveBeenCalled();
  expect(setSyncStatus).not.toHaveBeenCalled();
});

test('migrateSelftalkPhrases POSTs every unioned phrase (retry-safe) + flips status; [] on full success', async () => {
  api.mockResolvedValue({ ok: true });
  const cloud = [{ id: 'st-1', jp: 'これは', mean: 'this' }];
  const local = [{ id: 'usr-2', jp: 'それは', mean: 'that' }];
  await expect(migrateSelftalkPhrases(local, cloud)).resolves.toEqual([]);
  expect(api).toHaveBeenCalledTimes(2);
  expect(api).toHaveBeenCalledWith('/v1/sentences', expect.objectContaining({ method: 'POST', retry: true }));
  expect(setSyncStatus).toHaveBeenCalledWith('✓ phrases migrated');
});

test('migrateSelftalkPhrases unions by id — LOCAL wins a dup id (its body is sent)', async () => {
  api.mockResolvedValue({ ok: true });
  const cloud = [{ id: 'dup', jp: 'クラウド', mean: 'cloud-copy' }];
  const local = [{ id: 'dup', jp: 'ローカル', mean: 'local-copy' }];
  await migrateSelftalkPhrases(local, cloud);
  expect(api).toHaveBeenCalledTimes(1);                         // one id → one POST
  expect(api.mock.calls[0][1].body.translations.en).toBe('local-copy');   // local won
});

test('migrateSelftalkPhrases returns the FAILED phrases, keeps going, partial success still flips status', async () => {
  api.mockRejectedValueOnce(new Error('down')).mockResolvedValue({ ok: true });
  const phrases = [{ id: 'a', jp: 'あ', mean: 'a' }, { id: 'b', jp: 'い', mean: 'b' }];
  const failed = await migrateSelftalkPhrases(phrases, []);
  expect(api).toHaveBeenCalledTimes(2);            // both attempted despite the first failing
  expect(failed.map((p) => p.id)).toEqual(['a']);  // only the failed one is returned for retry
  expect(setSyncStatus).toHaveBeenCalledWith('✓ phrases migrated');   // 2 attempted > 1 failed
});

test('migrateSelftalkPhrases when EVERY POST fails returns them all + does NOT flip status', async () => {
  api.mockRejectedValue(new Error('down'));
  const phrases = [{ id: 'a', jp: 'あ', mean: 'a' }, { id: 'b', jp: 'い', mean: 'b' }];
  const failed = await migrateSelftalkPhrases(phrases, []);
  expect(failed.map((p) => p.id)).toEqual(['a', 'b']);
  expect(setSyncStatus).not.toHaveBeenCalledWith('✓ phrases migrated');
});

test('migrateSelftalkPhrases ignores entries without an id', async () => {
  api.mockResolvedValue({ ok: true });
  await migrateSelftalkPhrases([{ jp: 'no id' }, null], [{ id: 'x', jp: 'ok', mean: 'm' }]);
  expect(api).toHaveBeenCalledTimes(1);   // only the id'd cloud phrase
});

// ───────────────────────── migrateCardExamples ─────────────────────────

test('migrateCardExamples is a no-op when signed out', async () => {
  ctx.account = null;
  await migrateCardExamples();
  expect(api).not.toHaveBeenCalled();
  expect(localStorage.getItem(CARDEX_KEY)).toBeNull();   // not even the flag — re-attempt next sign-in
});

test('migrateCardExamples is a no-op once the migrated flag is set', async () => {
  localStorage.setItem(CARDEX_KEY, '1');
  loadCustom.mockReturnValue({ verbs: [{ rank: 101, ex: [['食べる', 'eat']] }] });
  await migrateCardExamples();
  expect(api).not.toHaveBeenCalled();
});

test('migrateCardExamples with no eligible cards just sets the flag (no API)', async () => {
  loadCustom.mockReturnValue({ verbs: [{ rank: 101 /* no ex, no levels */ }] });
  await migrateCardExamples();
  expect(api).not.toHaveBeenCalled();
  expect(localStorage.getItem(CARDEX_KEY)).toBe('1');
});

test('migrateCardExamples PUTs each eligible card (filtering empties) + sets the flag when all succeed', async () => {
  api.mockResolvedValue({ ok: true });
  loadCustom.mockReturnValue({ verbs: [
    { rank: 101, ex: [['食べる', 'eat']] },
    { rank: 102, levels: { N5: ['見る', 'see'] } },
    { rank: 103 },   // ineligible — filtered out
  ] });
  await migrateCardExamples();
  expect(api).toHaveBeenCalledTimes(2);
  expect(api).toHaveBeenCalledWith('/v1/sentences/card/101', expect.objectContaining({ method: 'PUT' }));
  expect(api).toHaveBeenCalledWith('/v1/sentences/card/102', expect.objectContaining({ method: 'PUT' }));
  expect(localStorage.getItem(CARDEX_KEY)).toBe('1');
});

test('migrateCardExamples does NOT set the flag if any PUT fails (retried next sign-in)', async () => {
  api.mockRejectedValue(new Error('down'));
  loadCustom.mockReturnValue({ verbs: [{ rank: 101, ex: [['食べる', 'eat']] }] });
  await migrateCardExamples();
  expect(localStorage.getItem(CARDEX_KEY)).toBeNull();
});
