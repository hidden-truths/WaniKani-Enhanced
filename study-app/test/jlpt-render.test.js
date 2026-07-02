// Render-glue test for the 合格 JLPT package (src/features/jlpt/*) — the layer the
// pure core tests can't reach: the countdown hero, the daily checklist composing over
// live app signals (auto write-through + manual toggles via the delegated ACTIONS),
// the readiness cards, and the store round-trip, under happy-dom. Network, the synced
// blob and the WaniKani dataset are never touched: WK signals render their
// disconnected/loading fallbacks, and the word-list chunk is loaded for real (it's a
// local dynamic import) to exercise the coverage path.
import { test, expect, beforeEach, vi } from 'vitest';

// Hermetic stubs, mirroring wanikani-render.test.js: the synced-blob chain drags in
// cloud-core/transport; deck/browse would drag the whole picker; custom-cards fans out
// to every surface. The JLPT view only needs their jump/repaint entry points.
vi.mock('../src/features/synced-blob.js', () => ({
  createSyncedBlob: () => ({ schedule: () => {}, push: async () => {}, pull: async () => {} }),
}));
vi.mock('../src/features/deck.js', () => ({
  startDueSession: vi.fn(), studyLeechCards: vi.fn(), updateDueBanner: vi.fn(), studyWkCards: vi.fn(),
  studyGrammarDeck: vi.fn(), studyJlptCards: vi.fn(),
}));
vi.mock('../src/features/browse.js', () => ({ openBrowseGrammar: vi.fn(), openVerbDetail: vi.fn() }));
vi.mock('../src/features/custom-cards.js', () => ({ rebuildData: vi.fn(), refreshAfterVerbChange: () => {} }));
vi.mock('../src/features/cloud-core.js', () => ({ api: async () => ({}), setSyncStatus: vi.fn(), account: null }));

const bag = new Map();
vi.stubGlobal('localStorage', {
  getItem: (k) => (bag.has(k) ? bag.get(k) : null),
  setItem: (k, v) => bag.set(k, String(v)),
  removeItem: (k) => bag.delete(k),
  clear: () => bag.clear(),
});

import { state } from '../src/state.js';
import { localDay } from '../src/config.js';
import { shiftDay } from '../src/core/jlpt.js';
import { loadJlpt } from '../src/features/jlpt/store.js';
import { ensureJlptMap, ensureJlptWords } from '../src/features/jlpt/data.js';
import { ensureGrammarPoints } from '../src/features/grammar/data.js';
import { renderJlpt, wireJlpt } from '../src/features/jlpt/view.js';
import { loadCustom } from '../src/persistence/custom.js';

const TODAY = localDay();

beforeEach(() => {
  document.body.innerHTML = `<div class="panel active" id="panel-jlpt"><div id="jlptHead"></div><div id="jlptBody"></div></div>`;
  document.getElementById('panel-jlpt').dataset.jlWired = '';   // let wireJlpt re-attach per test DOM
  bag.clear();
  state.DATA = [];
  state.store = { cards: {}, sessions: [], daily: {} };
  state.selftalkStore = { phrases: [], practice: { lastDay: null, streak: 0, doneToday: [] } };
  state.minnaStore = { notes: {}, lastLesson: null, overlays: {} };
  state.wanikaniStore = { token: null };
  loadJlpt();   // → defaults (N3, 2026-12-06) via the Map-backed localStorage
});

test('hero renders the countdown, level chips, and the exam date editor', () => {
  state.jlptStore.examDate = shiftDay(TODAY, 10);
  renderJlpt();
  const head = document.getElementById('jlptHead').innerHTML;
  expect(head).toContain('04<span class="slash"> / 08</span>');
  expect(head).toContain('Road to N3');
  expect(head).toContain('data-jl-act="level"');
  const body = document.getElementById('jlptBody');
  expect(body.querySelector('.jl-days').textContent).toBe('10');
  expect(body.querySelector('#jlptDate').value).toBe(shiftDay(TODAY, 10));
  expect(body.innerHTML).toContain('1 week and 3 days');
});

test('checklist: auto tasks track live signals and write through to the day record', () => {
  renderJlpt();
  const body = document.getElementById('jlptBody').innerHTML;
  // no WK token → the WaniKani row offers Connect instead of a checkbox
  expect(body).toContain('connect your WaniKani account');
  expect(body).toContain('data-jl-act="go-wanikani"');
  // empty deck → 0 due → the SRS task is auto-done and persisted for the heatmap
  expect(state.jlptStore.days[TODAY].due).toBe(1);
  // 8 tasks render (incl. the 語 quota row); the unavailable WK row is excluded from the ring
  expect((body.match(/jl-task /g) || []).length + (body.match(/jl-task"/g) || []).length).toBeGreaterThanOrEqual(8);
  expect(document.querySelector('.jl-ring-center b').textContent).toContain('/7');
});

test('due cards + spoken-today flip their tasks live', () => {
  state.DATA = [{ rank: 1, jp: '一方', read: 'いっぽう' }];   // box 0 → due
  state.selftalkStore.practice = { lastDay: TODAY, streak: 3, doneToday: ['p1'] };
  renderJlpt();
  const body = document.getElementById('jlptBody').innerHTML;
  expect(body).toContain('1 due in your deck');
  expect(body).toContain('data-jl-act="go-due"');
  expect(body).toContain('day 3 streak');
  expect(state.jlptStore.days[TODAY].speak).toBe(1);          // spoke today → written through
  expect(state.jlptStore.days[TODAY].due).toBeUndefined();    // due>0 → not done
});

test('manual task toggles via the delegated click and persists per-day', () => {
  wireJlpt();
  renderJlpt();
  const check = document.querySelector('[data-jl-act="task"][data-task="listen"]');
  expect(check).toBeTruthy();
  check.click();
  expect(state.jlptStore.days[TODAY].listen).toBe(1);
  expect(document.querySelector('[data-jl-act="task"][data-task="listen"]').getAttribute('aria-checked')).toBe('true');
  document.querySelector('[data-jl-act="task"][data-task="listen"]').click();
  expect(state.jlptStore.days[TODAY].listen).toBeUndefined();
});

test('level chip switches the target level and re-renders', () => {
  wireJlpt();
  renderJlpt();
  document.querySelector('[data-jl-act="level"][data-level="N2"]').click();
  expect(state.jlptStore.level).toBe('N2');
  expect(document.getElementById('jlptHead').innerHTML).toContain('Road to N2');
  expect(document.getElementById('jlptBody').innerHTML).toContain('tuned for N3 for now');
});

test('readiness: real word-list chunk → N3 coverage over the deck', async () => {
  await ensureJlptMap();                                       // the real (local) dynamic import
  state.DATA = [{ rank: 1, jp: 'あいにく', read: 'あいにく' }, { rank: 2, jp: '食べる', read: 'たべる' }];
  state.store.cards = { 1: { attempts: [1, 1], right: 2, wrong: 0, box: 4, due: Date.now() + 864e5 } };
  renderJlpt();
  const body = document.getElementById('jlptBody').innerHTML;
  expect(body).toContain('N3 vocabulary coverage');
  expect(body).toContain('of 2,069 N3 words');                 // the real list's N3 total
  expect(body).toContain('1 solid (box 4+)');
  expect(body).toContain('Connect WaniKani');                  // no token → the coverage nudge
});

test('checklist heatmap renders 14 day cells from the record', () => {
  state.jlptStore.days[shiftDay(TODAY, -1)] = { due: 1, listen: 1 };
  renderJlpt();
  expect(document.querySelectorAll('.jl-heatcell').length).toBe(14);
  expect(document.querySelectorAll('.jl-heatcell.l1, .jl-heatcell.l2, .jl-heatcell.l3, .jl-heatcell.l4').length).toBeGreaterThanOrEqual(1);
});

test('pacing strip: verdict + needed-per-day math from the real list, target stepper persists', async () => {
  await ensureJlptMap();
  wireJlpt();
  state.jlptStore.examDate = shiftDay(TODAY, 158);             // ~2,069 uncovered / 144 eff days
  renderJlpt();
  const pace = document.querySelector('.jl-pace');
  expect(pace).toBeTruthy();
  expect(pace.innerHTML).toContain('new words/day');
  expect(document.getElementById('jlptTargetWords').value).toBe('12');   // DEFAULT_TARGETS, never in the blob
  expect(state.jlptStore.targets).toBeUndefined();
  // 2069/144 ≈ 15/day needed vs the 12/day target → behind
  expect(pace.querySelector('.jl-pace-verdict').className).toContain('warn');
  // stepper commits through normalize's 1..99 clamp and persists as the ONLY targets key
  const input = document.getElementById('jlptTargetWords');
  input.value = '20';
  input.dispatchEvent(new Event('change', { bubbles: true }));
  expect(state.jlptStore.targets).toEqual({ wordsPerDay: 20 });
  expect(document.querySelector('.jl-pace-verdict').className).toContain('good');   // 20/day → ahead
});

test('gap-fill: quota row + one-tap add writes tagged cards into the custom blob', async () => {
  await ensureJlptMap();
  await ensureJlptWords('N3');
  wireJlpt();
  state.jlptStore.examDate = shiftDay(TODAY, 158);
  renderJlpt();
  const body = () => document.getElementById('jlptBody').innerHTML;
  expect(body()).toContain('0/12 added today');
  expect(body()).toContain('covered either way');
  document.querySelector('[data-jl-act="gap-add"]').click();
  await new Promise((r) => setTimeout(r, 0));                  // the async ACTION resolves
  const cs = loadCustom();
  expect(cs.verbs.length).toBe(12);                            // today's full quota
  expect(cs.verbs[0]).toMatchObject({ jlptfill: true, jlpt: 'N3', added: TODAY, custom: true });
  expect(cs.verbs[0].tags).toContain('jlpt-n3');
  expect(cs.verbs[0].mean).toBeTruthy();                       // JMdict gloss made it through
});

test('grammar lens: real catalog renders coverage + per-point rows; 法 row flips auto with grammar cards', async () => {
  const pts = await ensureGrammarPoints();                     // the real generated chunk
  renderJlpt();
  const body = () => document.getElementById('jlptBody').innerHTML;
  expect(body()).toContain('N3 grammar');
  expect(body()).toContain(`Add all ${pts.length}`);
  expect(body()).toContain(`All ${pts.length} points`);
  expect(body()).toContain('data-jl-act="gp-add"');
  // no grammar cards yet → the 法 row is MANUAL with the lens nudge
  expect(document.querySelector('[data-jl-act="task"][data-task="grammar"]')).toBeTruthy();
  // seed one drilled-today grammar card → the row turns AUTO + done and writes through
  state.DATA = [{ rank: 200, jp: '〜ようになる', read: 'ようになる', mean: 'come to', cat: 'grammar', tags: ['文法'], grammar: true, grammarId: pts[0].id }];
  state.store.cards = { 200: { attempts: [1], right: 1, wrong: 0, box: 1, due: 0, last: Date.now() } };
  renderJlpt();
  expect(document.querySelector('[data-jl-act="task"][data-task="grammar"]')).toBeFalsy();   // no manual checkbox
  expect(body()).toContain('grammar drilled today');
  expect(state.jlptStore.days[TODAY].grammar).toBe(1);         // written through to the record
  expect(body()).toContain('data-jl-act="go-grammar-drill"');
});

test('the four papers render with deep-link actions', () => {
  renderJlpt();
  const body = document.getElementById('jlptBody').innerHTML;
  for (const jp of ['語彙', '文法', '読解', '聴解']) expect(body).toContain(jp);
  expect(body).toContain('data-jl-act="go-grammar"');
  expect(body).toContain('data-jl-act="go-songs"');
  expect(body).toContain('data-jl-act="go-minna"');
  expect(body).toContain('data-jl-act="go-selftalk"');
});
