// Integration test for the decomposed 独り言 Self-Talk package (src/features/selftalk/*). The C0/C1
// decomposition centralizes view-state into a shared `S` and routes every reference through it — a
// MISSED reference is a runtime ReferenceError that `bun run build` can't catch (esbuild treats a
// bare identifier as a global). The pure-core tests don't exercise the render glue either. So this
// test imports the real package and DRIVES the render path (renderSelftalk → renderHead + renderGrid,
// drillTopic → renderTopic, toggleGrammar, and initSelftalk's wiring) under happy-dom, with the
// engine / audio / network mocked — turning "build can't catch it" into "a test catches it". The live
// mic/record/compare flow stays a manual browser pass (headless blocks getUserMedia).
import { test, expect, beforeEach, afterEach, vi } from 'vitest';

// --- mock the side-effecting collaborators (engine, audio, network, persistence) ---
const ctx = vi.hoisted(() => ({ account: null }));
vi.mock('../src/features/record-compare.js', () => ({
  RECORD_SUPPORTED: false,
  isSpeakingMode: () => false,
  exitSpeakingMode: () => {},
  recordControlHtml: () => '',
  wireRecordCompare: () => {},
  paintCompareWaveforms: () => {},
  setOnTakeSaved: () => {},
}));
vi.mock('../src/features/speaking-bar.js', () => ({
  createSpeakingBar: () => ({ mount: () => {}, onToggle: () => {} }),
  clearSpeakingBar: () => {},
  releaseMicIfHidden: () => false,
}));
vi.mock('../src/features/word-lookup.js', () => ({ wireWordTaps: () => {} }));
vi.mock('../src/features/audio.js', () => ({ playItem: () => {}, cycleMod: () => false }));
vi.mock('../src/features/cloud-core.js', () => ({
  get account() { return ctx.account; },
  api: vi.fn(async () => ({ sentences: [], templates: [] })),
  setSyncStatus: vi.fn(),
}));
vi.mock('../src/persistence/selftalk.js', () => ({ loadSelftalk: () => {}, saveSelftalk: () => {} }));

import { state } from '../src/state.js';
import { S } from '../src/features/selftalk/state.js';
import { SELFTALK_TOPICS } from '../src/data/selftalk.js';
import { renderSelftalk, drillTopic, toggleGrammar } from '../src/features/selftalk/view.js';
import * as pkg from '../src/features/selftalk.js';

const TOPIC = SELFTALK_TOPICS[0].id;
const html = (id) => document.getElementById(id).innerHTML;

beforeEach(() => {
  // Map-backed localStorage (the env stub is partial) — store.js's caches read/write through it.
  const store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k), clear: () => store.clear(),
  });
  document.body.innerHTML = `
    <div id="stHead"></div><div id="stBody"></div><div id="navExtra"></div>
    <div id="panel-selftalk" class="active"></div>`;
  ctx.account = null;
  // Reset the shared view-state + seed a couple of phrases on a real topic.
  Object.assign(S, { stGrammar: [], stTopic: null, tplPicks: {}, recordingsLoaded: false, storeTemplates: [], editingId: null });
  S.storePhrases = [
    { id: 'st-a', jp: '今日は晴れです', read: 'きょうははれです', mean: 'It is sunny today', topic: TOPIC, grammar: [] },
    { id: 'st-b', jp: '元気です', read: 'げんきです', mean: 'I am fine', topic: TOPIC, grammar: [] },
  ];
  state.selftalkStore = { practice: {} };
});
afterEach(() => { vi.unstubAllGlobals(); });

test('the package barrel exports the public API main.js + cloud.js consume', () => {
  for (const name of ['initSelftalk', 'showSelftalk', 'onSelftalkHidden', 'refreshPhrases', 'refreshTemplates', 'renderSelftalk']) {
    expect(typeof pkg[name], name).toBe('function');
  }
});

test('renderSelftalk paints the head + the daily-5 featured card/rail + the topic browser — no ReferenceError', () => {
  renderSelftalk();
  expect(html('stHead')).toContain('独り言');
  expect(html('stHead')).toContain('data-stgram="all"');   // the grammar "All" chip
  const body = html('stBody');
  // hybrid grid (stTopic === null): a "Now speaking" featured card + a "Today's prompts" rail,
  // ATOP the kept category/topic browser.
  expect(body).toContain('st-daily');
  expect(body).toContain('st-now');               // the featured card wrapper
  expect(body).toContain('data-st-feature="st-a"'); // a rail card
  expect(body).toContain('st-cell');              // the topic browser kept below
  expect(body).toContain('st-grid');
  // exactly ONE phrase card renders in the grid (the featured) — preserves the
  // one-record-control-per-(scope,id)-per-view invariant (rail cards carry no record control).
  expect((body.match(/st-play/g) || []).length).toBe(1);
});

test('drillTopic renders that topic\'s phrase list (the only view with record controls)', () => {
  drillTopic(TOPIC);
  expect(S.stTopic).toBe(TOPIC);
  const body = html('stBody');
  expect(body).toContain('st-phrase');
  expect(body).toContain('st-back');           // back-to-grid affordance
  expect(body).toContain('It is sunny today'); // the seeded phrase rendered
  expect(body).toContain('I am fine');
});

test('drillTopic(null) returns to the grid (daily-5 + browser, not the drilled topic list)', () => {
  drillTopic(TOPIC);
  drillTopic(null);
  expect(S.stTopic).toBeNull();
  const body = html('stBody');
  expect(body).toContain('st-cell');     // the topic browser
  expect(body).toContain('st-daily');    // the daily-5 featured card + rail
  expect((body.match(/st-play/g) || []).length).toBe(1);   // one featured phrase, not the full topic list
});

test('toggleGrammar updates the filter and re-renders without throwing', () => {
  renderSelftalk();
  expect(() => toggleGrammar('some-grammar-id')).not.toThrow();
  expect(S.stGrammar).toEqual(['some-grammar-id']);
  // a grammar none of the seeded phrases carry → the grid shows the empty state
  expect(html('stBody')).toContain('No phrases match this filter');
  expect(() => toggleGrammar('all')).not.toThrow();   // master reset
  expect(S.stGrammar).toEqual([]);
  expect(html('stBody')).toContain('st-cell');
});

test('initSelftalk wires the tab without throwing (events + boot hydrate)', () => {
  // a minimal authoring modal so the modal-wiring branch is exercised too
  document.body.insertAdjacentHTML('beforeend', `
    <div id="stPhraseModal"><button id="stPhClose"></button><form id="stPhForm"></form><button id="stPhDelete"></button></div>`);
  expect(() => pkg.initSelftalk()).not.toThrow();
  expect(document.getElementById('panel-selftalk').dataset.stWired).toBe('1');
});
