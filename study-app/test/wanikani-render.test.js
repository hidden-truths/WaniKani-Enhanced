// Render-glue test for the 鰐蟹 WaniKani package (src/features/wanikani/*) — the layer
// the pure core tests can't reach: the token gate, the head/sub-nav, and the three
// views composing over seeded S data, under happy-dom. Network (api.wanikani.com),
// IndexedDB and the synced blob are never touched: we render directly with seeded
// state instead of driving showWanikani()'s load path.
import { test, expect, beforeEach, vi } from 'vitest';

// The synced-blob chain drags in cloud-core/transport; the render layer only needs a
// schedulable stub.
vi.mock('../src/features/synced-blob.js', () => ({
  createSyncedBlob: () => ({ schedule: () => {}, push: async () => {}, pull: async () => {} }),
}));

import { state } from '../src/state.js';
import { S, adoptWkData, resetWkData } from '../src/features/wanikani/state.js';
import { renderWanikani } from '../src/features/wanikani/view.js';
import { detailHtml } from '../src/features/wanikani/detail.js';

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
