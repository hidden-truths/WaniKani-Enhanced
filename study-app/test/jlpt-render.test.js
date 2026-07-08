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
  expect(body).toContain('No mock sat yet');
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
  vi.unstubAllGlobals();
  expect(el('jlptBody').innerHTML).toContain('No mock sat yet');
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
