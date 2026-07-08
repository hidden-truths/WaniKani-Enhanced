// 合格 JLPT tab — the 模試 mock-test log, split out of view.js (refactor-jlpt-view-split,
// step 3). The one readiness signal the tab CANNOT derive from app activity: a scored practice
// paper. Everything else on the tab (coverage, pace, streaks) measures effort; this measures
// outcome. The blob shape + merge semantics are core/jlpt.js; this owns the form, the verdict,
// the history, and the mock-* delegated ACTIONS (merged into view.js's ACTIONS table).
//
// The verdict deliberately shows the SECTIONAL minimum alongside the total, because the way a
// borderline candidate actually fails is 55/60/15 — a comfortable total with one section under 19.
import { state } from '../../state.js';
import { localDay } from '../../config.js';
import {
  examCountdown, escapeHtml,
  MOCK_SECTIONS, MOCK_LEVELS, MOCK_PASS, MOCK_MAX_TOTAL, normalizeMock, normalizeMocks,
  mockVerdict, mockTrend,
} from '../../core/index.js';
import { S, closeMockForm } from './state.js';
import { saveJlpt } from './store.js';
import { setSyncStatus } from '../cloud-core.js';
import { renderJlpt } from './view.js';   // runtime-only cycle (the mock-* actions re-render), precedented

// The latest same-level mock, surfaced beside the streaks: the one hero number that answers
// "would I pass today". Absent until a mock is logged (the pills row is already conditional).
export function mockPillHtml(store) {
  const trend = mockTrend(store.mocks, store.level);
  if (!trend) return '';
  const v = mockVerdict(trend.latest);
  return `<span class="pill mock ${v.pass ? 'pass' : 'fail'}" title="latest ${store.level} mock, ${trend.latest.date}"><span class="dot mock"></span>Mock&nbsp;<b>${trend.latest.total}</b>&nbsp;/&nbsp;${MOCK_MAX_TOTAL}</span>`;
}

/* ---- mock-test log --------------------------------------------------------------- */
//
// The one readiness signal the tab CANNOT derive from app activity: a scored practice paper.
// Everything else here (coverage, pace, streaks) measures effort; this measures outcome. The
// blob shape + merge semantics are core/jlpt.js; this is the form, the verdict, and the history.
//
// The verdict deliberately shows the SECTIONAL minimum alongside the total, because the way a
// borderline candidate actually fails is 55/60/15 — a comfortable total with one section under 19.

const mocksOf = (store) => store.mocks || [];
const secLabel = (key) => (MOCK_SECTIONS.find((s) => s.key === key) || {}).en || key;

export function mockLogHtml(store) {
  const mocks = mocksOf(store);
  const level = store.level;
  const supported = MOCK_LEVELS.includes(level);
  const trend = mockTrend(mocks, level);

  const cta = supported && !S.mockForm
    ? `<div class="jl-gp-ctas"><button class="chip primary jl-go" data-jl-act="mock-open">${mocks.length ? 'Log another' : 'Log a mock test'}</button></div>`
    : '';
  const head = `<section class="jl-card jl-mocks" id="jlMockLog">
    <div class="jl-card-head"><div><h2 class="title"><span class="jp-min">模試</span> · Mock tests</h2>
      <div class="sub">the one readiness signal the app can't derive — everything else measures effort, this measures outcome</div></div>${cta}</div>`;

  // N4/N5 report two sections, not three — don't offer a form that can't represent their score sheet.
  const unsupported = supported ? '' : `<div class="jl-covsub jl-mock-note">the mock log uses the ${MOCK_LEVELS.slice().reverse().join('/')} three-section score report (文字・語彙 / 文法・読解 / 聴解, 60 each). ${level} papers report two sections, so logging is off for this level.</div>`;

  const body = (S.mockForm ? mockFormHtml(store) : '')
    + (trend ? mockVerdictHtml(store, trend) : (supported && !S.mockForm ? mockEmptyHtml(level) : ''))
    + mockHistoryHtml(mocks);

  return `${head}${unsupported}${body}</section>`;
}

// Shown when there's no sitting AT THE TARGET LEVEL — which is not the same as no sitting at all
// (the verdict card is driven by mockTrend, which filters to the level, while the history below
// lists every level). Hence "No <level> mock", not "No mock": with two N2 papers logged and the
// target switched to N3, a bare "No mock sat yet" sat directly above "All 2 sittings".
function mockEmptyHtml(level) {
  const marks = MOCK_PASS[level] || MOCK_PASS.N3;
  return `<div class="jl-empty jl-mock-empty">No ${level} mock sat yet. Sit an official ${level} practice paper (the JLPT site publishes past/sample papers), then log the three section scores here.
    <span class="jl-covsub">${level} passes at <b>${marks.total}</b>/${MOCK_MAX_TOTAL} overall <em>and</em> at least <b>${marks.section}</b>/60 in every section — the total alone isn't enough.</span></div>`;
}

// The latest sitting: pass/fail, the total against the mark, and a bar per section with the
// sectional minimum drawn ON the track (a section under it fails you no matter the total).
function mockVerdictHtml(store, trend) {
  const m = trend.latest;
  const v = mockVerdict(m);
  const when = new Date(m.date + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const delta = trend.delta == null ? ''
    : `<span class="jl-mock-delta ${trend.delta > 0 ? 'good' : trend.delta < 0 ? 'warn' : ''}">${trend.delta > 0 ? '+' : ''}${trend.delta} vs previous</span>`;

  const why = v.pass
    ? `cleared ${v.needTotal} overall and ${v.needSection} in every section`
    : v.weakSections.length && v.totalOk
      ? `total is fine — but ${v.weakSections.map(secLabel).join(' and ')} ${v.weakSections.length === 1 ? 'is' : 'are'} under the ${v.needSection}-point sectional minimum, which fails you outright`
      : v.weakSections.length
        ? `${v.shortfall} short of ${v.needTotal}, and ${v.weakSections.map(secLabel).join(' and ')} under the ${v.needSection}-point minimum`
        : `${v.shortfall} short of ${v.needTotal} overall`;

  const bars = MOCK_SECTIONS.map((s) => {
    const score = m.scores[s.key] || 0;
    const pct = Math.round((100 * score) / s.max);
    const minPct = (100 * v.needSection) / s.max;
    const weak = score < v.needSection;
    return `<div class="jl-covrow"><span class="jl-cov-label"><span class="jp">${s.jp}</span></span>
      <span class="jl-covtrack"><span class="jl-covfill${weak ? ' weak' : ''}" style="width:${pct}%"></span><span class="jl-mock-min" style="left:${minPct}%" title="sectional minimum ${v.needSection}"></span></span>
      <b class="jl-covval${weak ? ' warn' : ''}">${score}<em>/${s.max}</em></b></div>`;
  }).join('');

  // Days-to-exam framing: a fail 150 days out reads very differently from a fail at 10.
  const cd = examCountdown(store.examDate, Date.now());
  const horizon = !cd || cd.past ? '' : v.pass
    ? `<div class="jl-covsub">${cd.days} days left — hold the pace and bank the margin.</div>`
    : `<div class="jl-covsub">${cd.days} days left${v.weakSections.length ? ` · the fastest points are in ${v.weakSections.map(secLabel).join(' + ')}` : ''}.</div>`;

  return `<div class="jl-mock-verdict ${v.pass ? 'pass' : 'fail'}">
      <span class="jl-mock-seal jp-min">${v.pass ? '合格' : '不合格'}</span>
      <div class="jl-mock-vmain">
        <b>${m.total}<em>/${MOCK_MAX_TOTAL}</em></b>
        <span class="jl-mock-why">${escapeHtml(why)}</span>
      </div>
      <div class="jl-mock-vmeta"><span>${when} · ${m.level}</span>${delta}${trend.points.length > 1 ? `<span>best ${trend.best}</span>` : ''}</div>
    </div>
    <div class="jl-mock-bars">${bars}</div>
    ${horizon}
    ${m.notes ? `<div class="jl-mock-notes">“${escapeHtml(m.notes)}”</div>` : ''}`;
}

function mockFormHtml(store) {
  const editing = S.mockEdit ? mocksOf(store).find((m) => m.id === S.mockEdit) : null;
  const today = localDay();
  // The level the save will write: an edit keeps the sitting's own (see `mock-save`), a new mock
  // takes the target. The marks copy below must name the SAME level the verdict will be judged on.
  const level = editing ? editing.level : store.level;
  // Precedence: the live draft (survives a re-render) → the mock being edited → blank/today.
  const d = S.mockDraft || {};
  const date = d.date != null ? d.date : (editing ? editing.date : today);
  const notes = d.notes != null ? d.notes : (editing && editing.notes ? editing.notes : '');
  const scoreOf = (k) => (d.scores && d.scores[k] != null ? d.scores[k] : (editing ? editing.scores[k] : ''));
  const fields = MOCK_SECTIONS.map((s) => `<label class="jl-mock-field">
      <span>${s.en} <em class="jp">${s.jp}</em></span>
      <input type="number" class="jl-mock-score" id="jlMock_${s.key}" min="0" max="${s.max}" step="1"
        value="${scoreOf(s.key)}" placeholder="0–${s.max}" aria-label="${s.en} score out of ${s.max}">
    </label>`).join('');
  return `<div class="jl-mock-form">
    <div class="jl-mock-frow">
      <label class="jl-mock-field"><span>Date sat</span>
        <input type="date" id="jlMockDate" value="${escapeHtml(date)}" max="${today}" aria-label="Date the mock was sat"></label>
      ${fields}
    </div>
    <label class="jl-mock-field wide"><span>Notes <em>optional</em></span>
      <input type="text" id="jlMockNotes" maxlength="500" value="${escapeHtml(notes)}" placeholder="ran out of time on 読解; listening section 2 was rough" aria-label="Notes"></label>
    <div class="jl-mock-fctas">
      <button class="chip primary jl-go" data-jl-act="mock-save">${editing ? `Save ${level} changes` : `Save ${level} mock`}</button>
      <button class="chip jl-go" data-jl-act="mock-cancel">Cancel</button>
      <span class="jl-covsub">scored against the ${level} marks: ${(MOCK_PASS[level] || MOCK_PASS.N3).total}/${MOCK_MAX_TOTAL} overall, ${(MOCK_PASS[level] || MOCK_PASS.N3).section}/60 per section</span>
    </div>
  </div>`;
}

// Every sitting, newest first — including OTHER levels (an N4 paper on the way to N3 is still
// history worth keeping), each judged against its OWN marks. Rendered whenever a mock exists,
// even a lone one: Edit/Delete live only here, so hiding the list at n=1 stranded the first mock
// with no way to fix a typo'd score.
function mockHistoryHtml(mocks) {
  if (!mocks.length) return '';
  const rows = mocks.map((m) => {
    const v = mockVerdict(m);
    const d = new Date(m.date + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    return `<div class="jl-mock-row">
      <span class="jl-gp-pip ${v.pass ? 'solid' : 'fail'}" title="${v.pass ? 'pass' : 'fail'}"></span>
      <span class="jl-mock-date">${d}</span>
      <span class="jl-mock-lvl">${m.level}</span>
      <span class="jl-mock-total"><b>${m.total}</b>/${MOCK_MAX_TOTAL}</span>
      <span class="jl-mock-secs">${MOCK_SECTIONS.map((s) => `<em class="${(m.scores[s.key] || 0) < v.needSection ? 'warn' : ''}">${m.scores[s.key] || 0}</em>`).join('·')}</span>
      <button class="chip jl-go sm" data-jl-act="mock-edit" data-mock="${escapeHtml(m.id)}">Edit</button>
      <button class="chip jl-go sm" data-jl-act="mock-del" data-mock="${escapeHtml(m.id)}" aria-label="Delete the ${d} mock">Delete</button>
    </div>`;
  }).join('');
  return `<details class="jl-gp-list jl-mock-history"><summary>All ${mocks.length} sitting${mocks.length === 1 ? '' : 's'}</summary><div class="jl-mock-rows">${rows}</div></details>`;
}

// Read the open form into a normalized mock (or null when the date/level is unusable). The form has
// no level field, so `level` is supplied by the caller: the edited sitting's own level, or the
// target level for a new mock (`mock-save`). Blank score fields read as 0 — a partially-scored
// paper is still a real data point.
function readMockForm(level) {
  const val = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
  const scores = {};
  for (const s of MOCK_SECTIONS) scores[s.key] = Number(val(`jlMock_${s.key}`)) || 0;
  return normalizeMock({ date: val('jlMockDate'), level, scores, notes: val('jlMockNotes') });
}

// Mirror a keystroke into S.mockDraft so an async re-render repaints what the user typed.
// Values are kept as RAW strings here (not normalized) — clamping mid-typing would fight the
// user; normalizeMock does the clamping once, on save.
export function captureMockField(el) {
  if (!S.mockForm || !el || !el.id) return false;
  const draft = S.mockDraft || (S.mockDraft = { scores: {} });
  if (el.id === 'jlMockDate') draft.date = el.value;
  else if (el.id === 'jlMockNotes') draft.notes = el.value;
  else if (el.id.startsWith('jlMock_')) (draft.scores || (draft.scores = {}))[el.id.slice(7)] = el.value;
  else return false;
  return true;
}

export const MOCK_ACTIONS = {
  'mock-open': () => { closeMockForm(); S.mockForm = true; renderJlpt(); },
  'mock-cancel': () => { closeMockForm(); renderJlpt(); },
  'mock-edit': (el) => { closeMockForm(); S.mockEdit = el.dataset.mock; S.mockForm = true; renderJlpt(); },
  'mock-save': () => {
    const store = state.jlptStore;
    // An EDIT keeps the sitting's OWN level — the form has no level field, and the history offers
    // Edit on other-level papers too (an N2 sat on the way to N3). Reading the current target level
    // here would re-badge that paper AND drop the original row via the id-collision filter below.
    // Only a NEW mock takes the target level (and `mock-open` is gated to MOCK_LEVELS).
    const editing = S.mockEdit ? mocksOf(store).find((x) => x.id === S.mockEdit) : null;
    // The row we opened for edit can vanish under us — a 409 mergeJlpt or a cloud pull replaces
    // state.jlptStore while the form sits open, or the sitting was deleted on another device. The
    // form's DOM is still populated, so falling through to the `store.level` branch below would
    // resurrect the deleted sitting AS A NEW MOCK at the current target level: exactly the
    // re-badging this handler exists to prevent. Bail instead; the re-render drops the stale form.
    if (S.mockEdit && !editing) {
      closeMockForm();
      setSyncStatus('that sitting is no longer in the log — nothing was saved');
      renderJlpt();
      return;
    }
    const m = readMockForm(editing ? editing.level : store.level);
    if (!m) { setSyncStatus('a mock needs a valid date'); return; }
    // The id is date+level, so re-dating an edited mock MOVES it — drop the old row first,
    // or the edit silently forks into two sittings.
    const kept = mocksOf(store).filter((x) => x.id !== m.id && x.id !== S.mockEdit);
    store.mocks = normalizeMocks([...kept, m]);
    closeMockForm();
    saveJlpt();
    const v = mockVerdict(m);
    setSyncStatus(v.pass ? `合格 — ${m.total}/${MOCK_MAX_TOTAL} on the ${m.level} mock` : `logged — ${m.total}/${MOCK_MAX_TOTAL}, ${v.shortfall ? `${v.shortfall} short` : 'sectional minimum missed'}`);
    renderJlpt();
  },
  'mock-del': (el) => {
    const store = state.jlptStore;
    const m = mocksOf(store).find((x) => x.id === el.dataset.mock);
    if (!m) return;
    if (!confirm(`Delete the ${m.date} ${m.level} mock (${m.total}/${MOCK_MAX_TOTAL})?`)) return;
    const left = mocksOf(store).filter((x) => x.id !== m.id);
    if (left.length) store.mocks = left; else delete store.mocks;   // omit the key when empty (normalizeJlpt's rule)
    if (S.mockEdit === m.id) closeMockForm();
    saveJlpt(); renderJlpt();
  },
};
