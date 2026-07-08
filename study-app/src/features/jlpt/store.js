// JLPT synced store — the small cloud-synced blob (app key 'jlpt'): the target level, the exam
// date, the rolling daily-checklist record, the mock-test log, and the 文法形式判断 per-point score
// trail (`mcq`). Off-bus like
// the Minna/WaniKani blobs: saveJlpt() schedules jlptBlob directly, and cloud.js lists the
// blob in its registry via the jlpt.js barrel. 409s MERGE (core/jlpt.js mergeJlpt — day
// records and mocks union so an entry made on either device survives, the mcq trail takes the
// per-point max of its monotonic counters; scalars local-wins).
import { state } from '../../state.js';
import { localDay } from '../../config.js';
import { normalizeJlpt, mergeJlpt } from '../../core/index.js';
import { createSyncedBlob } from '../synced-blob.js';

const KEY = 'jpverbs_jlpt';

// December 2026 JLPT (first Sunday). Editable in the tab; other sittings are a date away.
export const DEFAULT_EXAM_DATE = '2026-12-06';
const DEFAULTS = { level: 'N3', examDate: DEFAULT_EXAM_DATE };

export function emptyJlpt() { return normalizeJlpt(null, localDay(), DEFAULTS); }

// Hydrate state.jlptStore from localStorage. Call once at boot, before any reader.
export function loadJlpt() {
  let o = null;
  try { o = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  state.jlptStore = normalizeJlpt(o, localDay(), DEFAULTS);
  return state.jlptStore;
}

// Persist to localStorage only (instant, offline/anon-safe). saveJlpt() additionally
// schedules the debounced cloud push when signed in.
export function saveJlptLocal() {
  try { localStorage.setItem(KEY, JSON.stringify(state.jlptStore)); } catch (e) {}
}
export function saveJlpt() {
  saveJlptLocal();
  jlptBlob.schedule();
}

export const jlptBlob = createSyncedBlob({
  appKey: 'jlpt',
  read: () => state.jlptStore,
  apply: (data) => {
    if (data && typeof data === 'object' && (data.level || data.examDate || data.days || data.targets || data.mocks || data.mcq)) {
      state.jlptStore = normalizeJlpt(data, localDay(), DEFAULTS);
      saveJlptLocal();   // mirror WITHOUT re-pushing
      return true;
    }
    return false;   // nothing usable → fall through to the fresh-account seed
  },
  merge: mergeJlpt,
  // Seed the cloud only once the user has actually touched the tab (a day record, a
  // non-default date/level, a pacing target, a logged mock, or an answered MCQ question —
  // defaults are never materialized, so a targets/mocks/mcq key means the user made one) —
  // a fresh browser shouldn't push an empty blob.
  shouldSeed: () => {
    const s = state.jlptStore;
    return !!(s && (Object.keys(s.days || {}).length || s.level !== DEFAULTS.level || s.examDate !== DEFAULTS.examDate || Object.keys(s.targets || {}).length || (s.mocks || []).length || Object.keys(s.mcq || {}).length));
  },
});
