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
import { ensureGrammarPoints, ensureGrammarMcq } from '../src/features/grammar/data.js';
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
  // Wire BEFORE the first render, exactly as boot does (jlpt/index.js: wireJlpt() → renderJlpt()).
  // wireJlpt() also resets the view-only mock-form state, which is module-global and would
  // otherwise leak an open form from the previous test into this one's first render.
  wireJlpt();
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

/* ---- mock-test log (jlpt-followups) ----
   The form → blob → verdict round-trip through the REAL delegated ACTIONS table, plus the two
   traps: a re-render mid-typing must not eat the draft, and re-dating an edited mock must MOVE
   it (its id is date+level) rather than fork a second sitting.

   Dates are RELATIVE to today and always in the past: the form's `max=today` is a real constraint
   (you can't have sat a future paper) and happy-dom enforces it by refusing an out-of-range value,
   exactly as a browser's date picker would. A hardcoded future date silently reads back as ''. */

const D1 = shiftDay(TODAY, -30);
const D2 = shiftDay(TODAY, -7);
const el = (id) => document.getElementById(id);
const act = (a) => document.querySelector(`[data-jl-act="${a}"]`).click();
const fillMock = ({ date, v, g, l, notes }) => {
  const set = (id, val) => { const n = el(id); n.value = String(val); n.dispatchEvent(new Event('input', { bubbles: true })); };
  if (date != null) set('jlMockDate', date);
  if (v != null) set('jlMock_vocab', v);
  if (g != null) set('jlMock_grammarReading', g);
  if (l != null) set('jlMock_listening', l);
  if (notes != null) set('jlMockNotes', notes);
};

test('mock log: empty state names the N3 pass criteria, and the form round-trips into the blob', () => {
  renderJlpt(); wireJlpt();
  let body = el('jlptBody').innerHTML;
  expect(body).toContain('Mock tests');
  expect(body).toContain('No N3 mock sat yet');
  expect(body).toContain('95');    // the N3 total mark
  expect(body).toContain('19');    // …and the sectional minimum

  act('mock-open');
  fillMock({ date: D1, v: 40, g: 38, l: 30, notes: 'ran out of time' });
  act('mock-save');

  expect(state.jlptStore.mocks).toHaveLength(1);
  expect(state.jlptStore.mocks[0]).toMatchObject({
    id: `${D1}-N3`, date: D1, level: 'N3',
    scores: { vocab: 40, grammarReading: 38, listening: 30 }, total: 108, notes: 'ran out of time',
  });
  body = el('jlptBody').innerHTML;
  expect(body).toContain('合格');            // 108 ≥ 95 and every section ≥ 19
  expect(body).toContain('ran out of time');
  expect(el('jlptBody').querySelector('.jl-mock-verdict').className).toContain('pass');
  // …and the hero pill answers "would I pass today" without scrolling.
  const pill = el('jlptBody').querySelector('.pill.mock');
  expect(pill.className).toContain('pass');
  expect(pill.textContent.replace(/\s|\u00a0/g, '')).toContain('108/180');
});

test('mock log: a comfortable total with one section under 19 renders as a FAIL', () => {
  renderJlpt(); wireJlpt();
  act('mock-open');
  fillMock({ date: D1, v: 55, g: 60, l: 15 });   // 130/180 — but listening is 15
  act('mock-save');

  const body = el('jlptBody').innerHTML;
  expect(body).toContain('不合格');
  expect(body).toContain('130');
  expect(body).toContain('sectional minimum');
  expect(body).toContain('Listening');                     // named as the weak section
  expect(el('jlptBody').querySelector('.jl-mock-verdict').className).toContain('fail');
  expect(el('jlptBody').querySelector('.pill.mock').className).toContain('fail');
});

test('mock log: a re-render mid-typing does not eat the draft', () => {
  renderJlpt(); wireJlpt();
  act('mock-open');
  fillMock({ date: D2, v: 42, notes: 'half typed' });
  renderJlpt();                                            // e.g. the WK dataset landing
  expect(el('jlMockDate').value).toBe(D2);
  expect(el('jlMock_vocab').value).toBe('42');
  expect(el('jlMockNotes').value).toBe('half typed');
  // Cancel clears the draft so the next open starts clean.
  act('mock-cancel');
  act('mock-open');
  expect(el('jlMock_vocab').value).toBe('');
  expect(el('jlMockNotes').value).toBe('');
});

test('mock log: editing and RE-DATING a mock moves it instead of forking a second sitting', () => {
  renderJlpt(); wireJlpt();
  act('mock-open');
  fillMock({ date: D1, v: 30, g: 30, l: 30 });
  act('mock-save');
  expect(state.jlptStore.mocks).toHaveLength(1);

  act('mock-edit');                                        // only one row → only one Edit button
  expect(el('jlMock_vocab').value).toBe('30');             // prefilled from the stored mock
  fillMock({ date: D2, v: 45 });                           // new date → new id
  act('mock-save');

  expect(state.jlptStore.mocks).toHaveLength(1);           // MOVED, not forked
  expect(state.jlptStore.mocks[0]).toMatchObject({ id: `${D2}-N3`, date: D2, total: 105 });
});

// The verdict card is driven by mockTrend (filtered to the target level); the history lists EVERY
// level. So "no sitting at this level" must not claim "no sitting at all" while the history below
// it lists one.
test('mock log: the empty state names the target level when other-level sittings exist', () => {
  renderJlpt(); wireJlpt();
  state.jlptStore.mocks = [{ id: `${D1}-N2`, date: D1, level: 'N2', scores: { vocab: 44, grammarReading: 44, listening: 40 }, total: 128 }];
  state.jlptStore.level = 'N3';
  renderJlpt();

  const body = el('jlptBody').innerHTML;
  expect(body).toContain('All 1 sitting');       // the N2 paper is still history worth keeping…
  expect(body).toContain('No N3 mock sat yet');  // …but no N3 paper has been sat
  expect(body).not.toContain('No mock sat yet'); // the old copy contradicted the history below it
});

// The history renders an Edit button on EVERY sitting, including other-level ones (an N4 paper on
// the way to N3 is history worth keeping, judged against its own marks). The form has no level
// field, so a save must re-use the EDITED MOCK's level — not the current target level, which would
// silently re-badge the sitting and re-judge it against the wrong pass marks.
test('mock log: editing an other-level sitting keeps ITS level, not the current target level', () => {
  renderJlpt(); wireJlpt();
  // An N2 paper sat on the way to N3: 128/180 clears N2's 90 total with every section over 19.
  state.jlptStore.mocks = [{ id: `${D1}-N2`, date: D1, level: 'N2', scores: { vocab: 44, grammarReading: 44, listening: 40 }, total: 128 }];
  state.jlptStore.level = 'N3';
  renderJlpt();

  act('mock-edit');                                        // only one row → only one Edit button
  expect(el('jlMock_listening').value).toBe('40');         // prefilled from the stored N2 mock
  fillMock({ l: 42 });                                     // fix a typo'd listening score
  act('mock-save');

  expect(state.jlptStore.mocks).toHaveLength(1);           // edited in place, not forked
  expect(state.jlptStore.mocks[0]).toMatchObject({ id: `${D1}-N2`, level: 'N2', total: 130 });
});

// The edited row can vanish under an open form (a 409 mergeJlpt / cloud pull replaces jlptStore, or
// the sitting was deleted on another device). The form's DOM is still populated, so a save must NOT
// fall through to the new-mock branch — that would resurrect the deleted sitting at the TARGET level.
test('mock log: saving an edit whose row vanished writes nothing, rather than re-creating it', () => {
  renderJlpt(); wireJlpt();
  state.jlptStore.mocks = [{ id: `${D1}-N2`, date: D1, level: 'N2', scores: { vocab: 44, grammarReading: 44, listening: 40 }, total: 128 }];
  state.jlptStore.level = 'N3';
  renderJlpt();

  act('mock-edit');                                        // form opens on the N2 sitting
  expect(el('jlMock_vocab').value).toBe('44');
  state.jlptStore.mocks = [];                              // …a cloud pull lands: the row is gone
  act('mock-save');

  expect(state.jlptStore.mocks).toEqual([]);               // not resurrected as an N3 mock
  expect(el('jlptBody').querySelector('.jl-mock-form')).toBeNull();   // stale form dismissed
});

test('mock log: delete drops the row and removes the `mocks` key entirely when the last one goes', () => {
  renderJlpt(); wireJlpt();
  act('mock-open');
  fillMock({ date: D1, v: 30, g: 30, l: 30 });
  act('mock-save');
  expect('mocks' in state.jlptStore).toBe(true);

  vi.stubGlobal('confirm', () => false);
  act('mock-del');
  expect(state.jlptStore.mocks).toHaveLength(1);           // declined → untouched
  vi.stubGlobal('confirm', () => true);
  act('mock-del');
  expect('mocks' in state.jlptStore).toBe(false);          // key omitted, not left as []
  // NB: no vi.unstubAllGlobals() here — it would also tear down the file-level localStorage stub
  // (installed at import time, never reinstalled), silently disabling persistence for every test
  // that runs after this one. `confirm` staying stubbed is harmless; no later test calls it.
  expect(el('jlptBody').innerHTML).toContain('No N3 mock sat yet');   // back to the empty state
});

test('mock log: an unusable date is refused rather than silently stored', () => {
  renderJlpt(); wireJlpt();
  act('mock-open');
  fillMock({ date: '', v: 40, g: 40, l: 40 });
  act('mock-save');
  expect(state.jlptStore.mocks).toBe(undefined);
  expect(el('jlMockDate')).not.toBe(null);                 // form stays open so the fix is one keystroke
});

test('mock log: N4/N5 hide the form — their real score report has two sections, not three', () => {
  state.jlptStore.level = 'N4';
  renderJlpt(); wireJlpt();
  const body = el('jlptBody').innerHTML;
  expect(body).toContain('Mock tests');
  expect(body).toContain('two sections');
  expect(document.querySelector('[data-jl-act="mock-open"]')).toBe(null);
});

test('mock log: history lists every sitting, each judged against ITS OWN level marks', () => {
  // 90/180 passes N2 but not N3 — the history must not judge both against the target level.
  state.jlptStore.mocks = [
    { id: `${D1}-N2`, date: D1, level: 'N2', scores: { vocab: 30, grammarReading: 30, listening: 30 }, total: 90 },
    { id: `${D2}-N3`, date: D2, level: 'N3', scores: { vocab: 30, grammarReading: 30, listening: 30 }, total: 90 },
  ];
  renderJlpt(); wireJlpt();
  const rows = [...el('jlptBody').querySelectorAll('.jl-mock-row')];
  expect(rows).toHaveLength(2);
  expect(el('jlptBody').innerHTML).toContain('All 2 sittings');
  const pipOf = (lvl) => rows.find((r) => r.querySelector('.jl-mock-lvl').textContent === lvl).querySelector('.jl-gp-pip');
  expect(pipOf('N2').className).toContain('solid');   // 90 clears N2's 90
  expect(pipOf('N3').className).toContain('fail');    // …and misses N3's 95
  // The verdict block tracks the TARGET level only (the N3 sitting), not the newest of any level.
  expect(el('jlptBody').querySelector('.jl-mock-verdict').className).toContain('fail');
});

/* ---- 文法形式判断 MCQ drill (grammar-mcq-drills) ----
   Drives the REAL ACTIONS table over the REAL generated bank chunk (a local dynamic import, per the
   suite's "real lazy chunks are fine" convention). Pins the guards — no double-answer, no skipping
   an unanswered question — and that the drill takes over the grammar lens without touching the deck.

   `mcq-start` is an async ACTION (it awaits the bank chunk before assembling the quiz), so a click on
   it needs the microtask queue drained before the re-render is observable. A macrotask tick does that
   reliably; counting `await Promise.resolve()`s does not. */
const flush = () => new Promise((r) => setTimeout(r, 0));

test('mcq drill: the CTA appears once the bank chunk lands, and a run takes over the grammar lens', async () => {
  await ensureGrammarPoints();
  await ensureGrammarMcq();
  renderJlpt(); wireJlpt();
  expect(document.querySelector('[data-jl-act="mcq-start"]')).not.toBe(null);
  expect(el('jlptBody').innerHTML).toContain('文法形式判断');

  document.querySelector('[data-jl-act="mcq-start"]').click();
  await flush();                                             // mcq-start awaits ensureGrammarMcq
  expect(el('jlptBody').querySelector('.jl-mcq')).not.toBe(null);
  expect(el('jlptBody').querySelector('.jl-mcq-gap')).not.toBe(null);   // unanswered → inked gap
  expect(document.querySelectorAll('.jl-mcq-choice')).toHaveLength(4);
  expect(el('jlptBody').querySelector('.jl-gp-list')).toBe(null);       // the point list yielded
  expect(state.DATA).toEqual([]);                                       // …and no cards were touched
});

test('mcq drill: answering marks right/wrong, reveals the why, and blocks a second pick', async () => {
  await ensureGrammarPoints(); await ensureGrammarMcq();
  renderJlpt(); wireJlpt();
  document.querySelector('[data-jl-act="mcq-start"]').click();
  await flush();

  // Find the correct choice by rendering position: the .ok class only appears AFTER answering, so
  // pick blind, then assert the pair (fill class ⇔ why class) is internally consistent.
  document.querySelector('.jl-mcq-choice').click();
  const why = el('jlptBody').querySelector('.jl-mcq-why');
  expect(why).not.toBe(null);
  const correct = why.className.includes('ok');
  expect(el('jlptBody').querySelector(`.jl-mcq-fill.${correct ? 'ok' : 'bad'}`)).not.toBe(null);
  expect(el('jlptBody').querySelector('.jl-mcq-gap')).toBe(null);       // the gap is filled now
  expect(el('jlptBody').querySelector('.jl-mcq-choice.ok')).not.toBe(null);   // the answer is always shown
  expect([...document.querySelectorAll('.jl-mcq-choice')].every((b) => b.disabled)).toBe(true);

  // A second pick can't change the recorded result (the ACTIONS guard, not just `disabled`).
  const before = el('jlptBody').innerHTML;
  document.querySelectorAll('.jl-mcq-choice')[1].click();
  expect(el('jlptBody').innerHTML).toBe(before);
});

test('mcq drill: Next is inert until answered; the run walks to a score card', async () => {
  await ensureGrammarPoints(); await ensureGrammarMcq();
  renderJlpt(); wireJlpt();
  document.querySelector('[data-jl-act="mcq-start"]').click();
  await flush();

  expect(document.querySelector('[data-jl-act="mcq-next"]')).toBe(null);   // not offered yet
  const pos = () => el('jlptBody').querySelector('.jl-mcq-pos').textContent.replace(/\s/g, '');
  expect(pos()).toBe('1/10');

  // Walk the whole run: pick the first choice each time, then Next.
  for (let i = 0; i < 10; i++) {
    document.querySelector('.jl-mcq-choice').click();
    document.querySelector('[data-jl-act="mcq-next"]').click();
  }
  const done = el('jlptBody').querySelector('.jl-mcq-done');
  expect(done).not.toBe(null);
  expect(done.querySelector('.jl-mcq-score b').textContent).toMatch(/^\d+\/10$/);
  expect(state.DATA).toEqual([]);            // still no deck side-effects

  document.querySelector('[data-jl-act="mcq-close"]').click();
  expect(el('jlptBody').querySelector('.jl-mcq')).toBe(null);
  expect(el('jlptBody').querySelector('.jl-gp-list')).not.toBe(null);   // the lens is back
});

/* ---- the per-point score trail ---- */

test('mcq drill: every ANSWER writes through to the synced trail, even if the run is abandoned', async () => {
  await ensureGrammarPoints(); await ensureGrammarMcq();
  renderJlpt(); wireJlpt();
  document.querySelector('[data-jl-act="mcq-start"]').click();
  await flush();
  expect(state.jlptStore.mcq).toBe(undefined);            // nothing drilled yet → key absent

  document.querySelector('.jl-mcq-choice').click();
  document.querySelector('[data-jl-act="mcq-next"]').click();
  document.querySelector('.jl-mcq-choice').click();
  // Abandon mid-run: the two answered questions must survive.
  document.querySelector('[data-jl-act="mcq-close"]').click();

  const trail = { ...state.jlptStore.mcq };
  const answered = Object.values(trail).reduce((n, e) => n + e.right + e.wrong, 0);
  expect(answered).toBe(2);
  for (const e of Object.values(trail)) expect(e.last).toBe(TODAY);
  // …and it round-trips through the store (saveJlpt → saveJlptLocal → loadJlpt; the cloud push is
  // the inert stubbed blob). Asserted via loadJlpt rather than by reading localStorage directly:
  // that pins the store CONTRACT, not which Storage object this file's stub happens to install.
  state.jlptStore = null;
  loadJlpt();
  expect(state.jlptStore.mcq).toEqual(trail);
});

test('mcq drill: the lens badges drilled points and the 苦手 CTA drills only the weak ones', async () => {
  await ensureGrammarPoints();
  const bank = await ensureGrammarMcq();
  const [weakId, strongId] = Object.keys(bank);
  // A weak point (1/4 = 25%) and a strong one (4/4) — only the former is 苦手.
  state.jlptStore.mcq = { [weakId]: { right: 1, wrong: 3 }, [strongId]: { right: 4, wrong: 0 } };
  renderJlpt(); wireJlpt();

  const badges = [...el('jlptBody').querySelectorAll('.jl-gp-mcq')];
  expect(badges).toHaveLength(2);                              // only the two drilled points, not all 81
  expect(badges.filter((b) => b.classList.contains('weak'))).toHaveLength(1);

  const cta = document.querySelector('[data-jl-act="mcq-weak"]');
  expect(cta.textContent).toContain('1');                      // one weak point
  cta.click();
  await flush();
  expect(el('jlptBody').innerHTML).toContain('patterns you keep getting wrong');
  // The run is drawn ONLY from the weak point's bank — walk it and check nothing else got recorded.
  const total = bank[weakId].length;
  for (let i = 0; i < total; i++) {
    document.querySelector('.jl-mcq-choice').click();
    document.querySelector('[data-jl-act="mcq-next"]').click();
  }
  expect(el('jlptBody').querySelector('.jl-mcq-done')).not.toBe(null);
  expect(state.jlptStore.mcq[strongId]).toEqual({ right: 4, wrong: 0 });   // untouched
  const w = state.jlptStore.mcq[weakId];
  expect(w.right + w.wrong).toBe(4 + total);                               // all `total` answers landed here
});
