// Render-glue test for the 鰐蟹 WaniKani package (src/features/wanikani/*) — the layer
// the pure core tests can't reach: the token gate, the head/sub-nav, the three
// views composing over seeded S data, and the wk-leech-to-deck activation glue
// (activate.js against a real Map-backed localStorage), under happy-dom. Network
// (api.wanikani.com), IndexedDB and the synced blob are never touched: we render
// directly with seeded state instead of driving showWanikani()'s load path.
import { test, expect, beforeEach, vi } from 'vitest';

// The synced-blob chain drags in cloud-core/transport; the render layer only needs a
// schedulable stub. Same hermetic treatment for the app-wide surfaces view.js/activate.js
// now touch: the deck jump, the sync-status pill, and custom-cards' rebuild fan-out
// (custom-cards.js would drag deck/browse/stats/a11y and their eval-time localStorage reads).
vi.mock('../src/features/synced-blob.js', () => ({
  createSyncedBlob: () => ({ schedule: () => {}, push: async () => {}, pull: async () => {} }),
}));
vi.mock('../src/features/deck.js', () => ({ studyWkCards: vi.fn() }));
vi.mock('../src/features/cloud-core.js', () => ({ setSyncStatus: () => {}, api: async () => ({}), account: null }));
vi.mock('../src/features/custom-cards.js', () => ({ rebuildData: vi.fn(), refreshAfterVerbChange: () => {} }));

// persistence/custom.js reads localStorage at call time — give it a working Map-backed fake.
const bag = new Map();
vi.stubGlobal('localStorage', {
  getItem: (k) => (bag.has(k) ? bag.get(k) : null),
  setItem: (k, v) => bag.set(k, String(v)),
  removeItem: (k) => bag.delete(k),
  clear: () => bag.clear(),
});

import { state } from '../src/state.js';
import { S, adoptWkData, resetWkData } from '../src/features/wanikani/state.js';
import { renderWanikani } from '../src/features/wanikani/view.js';
import { detailHtml } from '../src/features/wanikani/detail.js';
import { activateWkVocab, wkInDeck, activatableWk } from '../src/features/wanikani/activate.js';
import { loadCustom } from '../src/persistence/custom.js';

const NOW = Date.now();
const subj = (id, type, chars, o = {}) => ({
  id, type, chars, level: o.level || 22, slug: chars, hidden: false, kana: undefined,
  imageUrl: null, docUrl: 'https://www.wanikani.com/x',
  meanings: o.meanings || [{ m: 'Meaning' + id, primary: true }],
  auxMeanings: [], readings: o.readings || [{ r: 'よみ', primary: true, type: null, accepted: true }],
  pos: o.pos || [], componentIds: o.componentIds || [], amalgamationIds: o.amalgamationIds || [],
  similarIds: [], meaningMnemonic: o.meaningMnemonic || null, meaningHint: null,
  readingMnemonic: null, readingHint: null, contextSentences: o.contextSentences || [],
  audio: o.audio || null,
});
const asg = (subjectId, stage) => ({
  id: subjectId * 10, subjectId, type: 'vocabulary', stage,
  availableAt: NOW + 3600e3, unlockedAt: NOW - 10e8, startedAt: NOW - 10e8,
  passedAt: null, burnedAt: null, hidden: false,
});
const stat = (subjectId, mi) => ({
  id: subjectId * 100, subjectId, subjectType: 'vocabulary',
  meaningCorrect: 10, meaningIncorrect: mi, readingCorrect: 10, readingIncorrect: 0,
  meaningCurrentStreak: 1, meaningMaxStreak: 5, readingCurrentStreak: 4, readingMaxStreak: 6,
  percentCorrect: 70, hidden: false,
});

function bundle() {
  const kanji = subj(10, 'kanji', '生', { amalgamationIds: [21, 22] });
  const v1 = subj(21, 'vocabulary', '生きる', { componentIds: [10], meaningMnemonic: 'To <kanji>live</kanji> well.', audio: 'https://cdn/a.mp3', contextSentences: [{ ja: '生きる。', en: 'Live.' }] });
  const v2 = subj(22, 'vocabulary', '生まれる', { componentIds: [10] });
  return {
    subjects: [kanji, v1, v2],
    assignments: [asg(10, 5), asg(21, 2), asg(22, 4)],
    stats: [stat(10, 0), stat(21, 6), stat(22, 0)],
    user: { username: 'tester', level: 22, subscription: { type: 'lifetime' } },
    summary: { lessons: 7, nextReviewsAt: null },
    progressions: [{ id: 1, level: 22, unlockedAt: NOW - 20 * 864e5, startedAt: NOW - 20 * 864e5, passedAt: null, abandonedAt: null }],
    lastSyncAt: NOW,
  };
}

beforeEach(() => {
  document.body.innerHTML = `
    <div class="panel active" id="panel-wanikani"><div id="wkHead"></div><div id="wkBody"></div></div>
    <div class="modal-overlay" id="wkModal"><div class="modal"><button id="wkModalX">×</button><div id="wkModalBody"></div></div></div>`;
  resetWkData();
  state.wanikaniStore = { token: null };
  state.DATA = [];
  bag.clear();
});

test('no token → the connect gate renders', () => {
  renderWanikani();
  const body = document.getElementById('wkBody');
  expect(body.innerHTML).toContain('Connect your WaniKani account');
  expect(body.querySelector('#wkTokenInput')).toBeTruthy();
  expect(body.innerHTML).toContain('personal_access_tokens');
});

test('token + loaded data → dashboard with metrics, pipeline, leech preview', () => {
  state.wanikaniStore = { token: 't' };
  adoptWkData(bundle());
  renderWanikani();
  const head = document.getElementById('wkHead').innerHTML;
  expect(head).toContain('Level 22');
  expect(head).toContain('tester');
  expect(head).toContain('07<span class="slash"> / 07</span>');
  const body = document.getElementById('wkBody').innerHTML;
  expect(body).toContain('wk-metrics');
  expect(body).toContain('SRS pipeline');
  expect(body).toContain('Review forecast');
  expect(body).toContain('Worst leeches');
  expect(body).toContain('生きる');   // the seeded leech shows in the preview
});

test('leeches view → confusion cluster around the shared kanji', () => {
  state.wanikaniStore = { token: 't' };
  adoptWkData(bundle());
  S.view = 'leeches';
  renderWanikani();
  const body = document.getElementById('wkBody').innerHTML;
  expect(body).toContain('Same-kanji confusion');
  expect(body).toContain('生');        // cluster head kanji
  expect(body).toContain('生まれる');  // non-leech sibling rides along
  expect(body).toContain('All leeches');
});

test('browse view → level grid + filters', () => {
  state.wanikaniStore = { token: 't' };
  adoptWkData(bundle());
  S.view = 'browse';
  renderWanikani();
  const body = document.getElementById('wkBody');
  expect(body.innerHTML).toContain('Level <b>22</b>');
  expect(body.querySelectorAll('.wk-tile').length).toBe(3);
  expect(body.querySelector('#wkSearch')).toBeTruthy();
});

test('detail html → record, mnemonic markup, family + sibling strips, audio', () => {
  state.wanikaniStore = { token: 't' };
  adoptWkData(bundle());
  const html = detailHtml(21);
  expect(html).toContain('生きる');
  expect(html).toContain('Apprentice');
  expect(html).toContain('wkm wkm-kanji');            // mnemonic tag → styled span
  expect(html).toContain('Made of these kanji');
  expect(html).toContain('Siblings of');              // the confusion helper strip
  expect(html).toContain('data-wk-act="audio"');
  expect(html).toContain('Context sentences');
  expect(html).toContain('leech');                    // 虫 badge (score 6 ≥ 1)
});

/* ---- wk-leech-to-deck ---------------------------------------------------------- */

test('leeches view renders the activation affordances (bulk add + per-family drill)', () => {
  state.wanikaniStore = { token: 't' };
  adoptWkData(bundle());
  S.view = 'leeches';
  renderWanikani();
  const body = document.getElementById('wkBody').innerHTML;
  expect(body).toContain('data-wk-act="addleeches"');       // bulk "Add all N to deck"
  expect(body).toContain('data-wk-act="addcluster"');       // per-family drill button
  expect(body).toContain('Drill this family');
});

test('activateWkVocab adds tagged cards once and skips words already in the deck', () => {
  adoptWkData(bundle());
  const v1 = S.subjects.get(21), v2 = S.subjects.get(22), kanji = S.subjects.get(10);
  // kanji are never card-able; 生まれる already in the deck under the same headword
  state.DATA = [{ rank: 7, jp: '生まれる' }];
  expect(activatableWk([kanji, v1, v2]).map((s) => s.id)).toEqual([21]);
  expect(activateWkVocab([kanji, v1, v2])).toBe(1);
  const added = loadCustom().verbs;
  expect(added.length).toBe(1);
  expect(added[0].jp).toBe('生きる');
  expect(added[0].wanikani).toBe(true);
  expect(added[0].wkId).toBe(21);
  expect(added[0].tags).toContain('鰐蟹');
  expect(added[0].rank).toBeGreaterThan(100);               // monotonic seq, custom range
  // idempotent: the deck now carries wkId 21 (rebuildData is mocked, so mirror it)
  state.DATA = [...state.DATA, ...added];
  expect(wkInDeck(v1)).toBe(true);
  expect(activateWkVocab([v1, v2])).toBe(0);                // wkId match + headword match both skip
});

test('detail modal offers Add to deck for vocab and shows in-deck state after activation', () => {
  adoptWkData(bundle());
  expect(detailHtml(21)).toContain('data-wk-act="addsubject"');
  expect(detailHtml(10)).not.toContain('data-wk-act="addsubject"');   // kanji: no card path
  activateWkVocab([S.subjects.get(21)]);
  state.DATA = [...loadCustom().verbs];                     // rebuildData is mocked — mirror it
  const html = detailHtml(21);
  expect(html).not.toContain('data-wk-act="addsubject"');
  expect(html).toContain('in your deck');
  expect(html).toContain('data-wk-act="studywk"');
});

test('dashboard leech metric jumps to the Leeches view', () => {
  state.wanikaniStore = { token: 't' };
  adoptWkData(bundle());
  renderWanikani();
  const body = document.getElementById('wkBody').innerHTML;
  expect(body).toMatch(/<button class="wk-metric leech act" data-wk-act="view" data-view="leeches">/);
});
