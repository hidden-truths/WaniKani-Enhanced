// Integration test for the CUSTOM-CARD CRUD glue (src/features/custom-cards.js) — the user-data
// path (authored cards persist locally, sync as the custom-verbs blob, and dual-write examples to
// the sentence store), previously hand-verified only. Drives the REAL #verbModal form + the real
// persistence/custom.js (Map-backed localStorage) under happy-dom, with the sibling render surfaces
// (deck/browse/stats/a11y) and the network mocked.
//
// The assertions pin the DATA INVARIANTS the docs call load-bearing: ranks come from a monotonic
// seq and are NEVER reused (progress keyed by rank can't collide across deletes), editing keeps the
// rank (and so the progress), deleting drops the orphaned progress row, hidden per-category fields
// store '' (no stale type/trans), and the store dual-write fires signed-in only.
import { test, expect, beforeEach, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ account: null, api: vi.fn(async () => ({})) }));
vi.mock('../src/features/cloud-core.js', () => ({
  get account() { return ctx.account; },
  api: (...args) => ctx.api(...args),
  setSyncStatus: () => {},
}));
vi.mock('../src/features/deck.js', () => ({
  cfg: { rmax: 100 }, updateDeckCount: () => {}, updateDueBanner: () => {},
}));
vi.mock('../src/features/browse.js', () => ({ bcfg: { rmax: 100 }, renderBrowse: () => {} }));
vi.mock('../src/features/stats.js', () => ({ renderStats: () => {} }));
vi.mock('../src/features/a11y.js', () => ({
  annotateJlptChips: () => {}, annotateCatChips: () => {}, annotateSourceChips: () => {},
}));

// Map-backed localStorage BEFORE importing the module under test (persistence/custom reads through it).
const bag = new Map();
vi.stubGlobal('localStorage', {
  getItem: (k) => (bag.has(k) ? bag.get(k) : null),
  setItem: (k, v) => bag.set(k, String(v)),
  removeItem: (k) => bag.delete(k), clear: () => bag.clear(),
});

import { state } from '../src/state.js';
import { loadCustom, saveCustomLocal } from '../src/persistence/custom.js';
import { rebuildData, openVerbModal, deleteVerb, initCustomUI } from '../src/features/custom-cards.js';

const JLPT_INPUTS = ['N5', 'N4', 'N3', 'N2', 'N1']
  .map(t => `<input id="vfLv${t}jp"><input id="vfLv${t}en">`).join('');
document.body.innerHTML = `
  <button id="addVerbBtn"></button><div id="customCount"></div>
  <div id="panel-stats"></div>
  <div id="verbModal"><div id="verbTitle"></div><div id="verbErr"></div>
    <form id="verbForm">
      <input id="vfJp"><input id="vfRead"><input id="vfMean">
      <select id="vfCat"><option value="verb">verb</option><option value="noun">noun</option><option value="adjective">adjective</option></select>
      <span id="vfTypeCell"><select id="vfType"></select></span>
      <select id="vfJlpt"><option>N5</option><option>N4</option></select>
      <span id="vfTransCell"><select id="vfTrans"><option value=""></option><option value="t">t</option></select></span>
      <input id="vfTags"><textarea id="vfMnem"></textarea><textarea id="vfTip"></textarea>
      <input id="vfExJp"><input id="vfExEn">
      <input id="vfAccent"><span id="vfAccentPreview"></span>
      <details id="vfMore">${JLPT_INPUTS}</details>
      <button id="verbSubmit" type="submit"></button>
      <button id="verbDelete" type="button" hidden></button>
      <button id="verbClose" type="button"></button>
    </form>
  </div>`;
initCustomUI();

const el = (id) => document.getElementById(id);
const set = (id, v) => { el(id).value = v; };
const submit = () => el('verbForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
// Fill the minimal valid card and submit the real form.
function addCard({ jp, read, mean, cat = 'verb' }) {
  openVerbModal(null);
  set('vfJp', jp); set('vfRead', read); set('vfMean', mean);
  set('vfCat', cat); el('vfCat').dispatchEvent(new Event('change'));
  submit();
}

beforeEach(() => {
  bag.clear();
  state.store = { cards: {}, sessions: [], daily: {} };
  state.exampleLevels = {};
  state.minnaStore = { overlays: {} };
  ctx.account = null;
  ctx.api.mockClear();
  rebuildData();
});

test('missing required fields error out without touching the store', () => {
  addCard({ jp: '', read: 'よむ', mean: 'to read' });
  expect(el('verbErr').textContent).toMatch(/required/);
  expect(loadCustom().verbs).toHaveLength(0);
});

test('a new card gets the next monotonic rank, the custom tag, and joins the live deck', () => {
  addCard({ jp: '読む', read: 'よむ', mean: 'to read' });
  const cs = loadCustom();
  expect(cs.seq).toBe(101);
  expect(cs.verbs[0]).toMatchObject({ rank: 101, jp: '読む', custom: true });
  expect(cs.verbs[0].tags).toContain('custom');
  expect(state.MAXRANK).toBe(101);
  expect(state.DATA.find(v => v.rank === 101)).toBeTruthy();
});

test('non-verb categories store empty type/trans (no stale verb fields)', () => {
  addCard({ jp: '天気', read: 'てんき', mean: 'weather', cat: 'noun' });
  expect(loadCustom().verbs[0]).toMatchObject({ cat: 'noun', type: '', trans: '' });
});

test('editing keeps the rank — and therefore the SRS progress', () => {
  addCard({ jp: '読む', read: 'よむ', mean: 'to read' });
  state.store.cards[101] = { attempts: [1, 1], right: 2, wrong: 0, box: 2, due: 9 };
  openVerbModal(loadCustom().verbs[0]);
  set('vfMean', 'to read (books)');
  submit();
  const cs = loadCustom();
  expect(cs.verbs).toHaveLength(1);
  expect(cs.verbs[0]).toMatchObject({ rank: 101, mean: 'to read (books)' });
  expect(state.store.cards[101].box).toBe(2);            // progress untouched
});

test('deleting drops the card + its orphaned progress, and the rank is NEVER reused', () => {
  addCard({ jp: '読む', read: 'よむ', mean: 'to read' });
  addCard({ jp: '書く', read: 'かく', mean: 'to write' });
  state.store.cards[101] = { attempts: [1], right: 1, wrong: 0, box: 1, due: 9 };
  deleteVerb(101);
  expect(loadCustom().verbs.map(v => v.rank)).toEqual([102]);
  expect(state.store.cards[101]).toBeUndefined();        // orphan cleaned
  addCard({ jp: '見る', read: 'みる', mean: 'to see' });
  expect(loadCustom().verbs.map(v => v.rank)).toEqual([102, 103]); // 101 not recycled
});

test('accent + leveled-example validation gates the save (0 is a VALID heiban accent)', () => {
  openVerbModal(null);
  set('vfJp', '橋'); set('vfRead', 'はし'); set('vfMean', 'bridge');
  set('vfAccent', '13');                                  // out of range
  submit();
  expect(el('verbErr').textContent).toMatch(/0 to 12/);
  expect(loadCustom().verbs).toHaveLength(0);
  set('vfAccent', '0');                                   // heiban — valid
  set('vfLvN5jp', '<b>bad</b>');                          // not clean ruby
  submit();
  expect(el('verbErr').textContent).toMatch(/N5/);
  set('vfLvN5jp', '<ruby>橋<rt>はし</rt></ruby>を渡る。'); set('vfLvN5en', 'Cross the bridge.');
  submit();
  const v = loadCustom().verbs[0];
  expect(v.accent).toBe(0);
  expect(v.levels.N5).toEqual(['<ruby>橋<rt>はし</rt></ruby>を渡る。', 'Cross the bridge.']);
});

test('the example dual-write PUTs to the sentence store signed-in, and stays silent for anon', async () => {
  addCard({ jp: '読む', read: 'よむ', mean: 'to read' });
  expect(ctx.api).not.toHaveBeenCalled();                 // anon: no corpus write
  ctx.account = { id: 1, email: 'dev@example.com' };
  openVerbModal(loadCustom().verbs[0]);
  submit();
  expect(ctx.api).toHaveBeenCalledWith('/v1/sentences/card/101', expect.objectContaining({ method: 'PUT' }));
  ctx.api.mockClear();
  deleteVerb(101);                                        // delete clears the rows (empty replace)
  expect(ctx.api).toHaveBeenCalledWith('/v1/sentences/card/101', expect.objectContaining({ method: 'PUT', body: { examples: [] } }));
});
