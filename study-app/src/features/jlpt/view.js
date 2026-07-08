// 合格 JLPT tab — render + the attach-once delegated wiring (the songs/wanikani ACTIONS
// pattern). The tab is MISSION CONTROL for the exam goal: countdown hero, the daily
// training checklist (auto-checked from live app signals where a signal exists, manual
// elsewhere; per-day record synced in the 'jlpt' blob), the vocabulary-readiness lens
// (deck + WaniKani coverage of the target level via the bundled JLPT list), and the
// four exam sections mapped onto the app surfaces that train them. All derivation is
// core/jlpt.js; signals come from the same stores the other tabs already keep.
import { state } from '../../state.js';
import { localDay } from '../../config.js';
import { selectGapBatch } from '../../core/index.js';
import { jlptMap, ensureJlptMap, jlptWords, ensureJlptWords } from './data.js';
import { addJlptWords } from './activate.js';
import { grammarPoints, ensureGrammarPoints, activateGrammarPoints, grammarMcq, ensureGrammarMcq } from '../grammar/index.js';
import { saveJlpt } from './store.js';
import { setSyncStatus } from '../cloud-core.js';
import { startDueSession, studyLeechCards, studyGrammarDeck, studyJlptCards } from '../deck.js';
import { openBrowseGrammar, openVerbDetail } from '../browse.js';
// The panel-active / tab-jump helpers + the form/drill close helpers (jlpt/state.js — refactor step 1).
import { closeMockForm, closeMcq, panelActive, goTab } from './state.js';
import { sectionsHtml } from './sections.js';   // the four-papers grid (refactor step 2)
import { mockLogHtml, captureMockField, MOCK_ACTIONS } from './mocks.js';   // 模試 log (refactor step 3)
import { MCQ_ACTIONS } from './mcq.js';   // 文法形式判断 drill (refactor step 4)
import { collectSignals, deriveGapContext } from './signals.js';   // the live-signal read (refactor step 5)
import { buildTasks, persistDone, checklistHtml } from './checklist.js';   // daily checklist (refactor step 6)
import { headHtml, heroHtml } from './hero.js';   // head + countdown hero (refactor step 7a)
import { readinessHtml } from './coverage.js';   // vocabulary-readiness lens (refactor step 7b)
import { grammarLensHtml } from './grammar-lens.js';   // grammar-readiness lens (refactor step 7c)

/* ---- render --------------------------------------------------------------------- */

export function renderJlpt() {
  const head = document.getElementById('jlptHead');
  const body = document.getElementById('jlptBody');
  if (!head || !body) return;
  const store = state.jlptStore;
  const sig = collectSignals();
  const dayRec = (store.days || {})[sig.today] || {};
  const tasks = buildTasks(sig, dayRec);
  persistDone(tasks, sig.today);

  head.innerHTML = headHtml(store);
  body.innerHTML = heroHtml(store, sig, tasks)
    + checklistHtml(store, sig, tasks)
    + readinessHtml(store, sig)
    + grammarLensHtml(store, sig)
    + mockLogHtml(store)
    + sectionsHtml(store);

  // Kick the lazy chunks this render found missing; each resolves at most once (the loaders
  // memoize), and the loaded-state guard means the resolve-time re-render can't loop.
  if (jlptMap() && !jlptWords(store.level)) ensureJlptWords(store.level).then(() => { if (panelActive()) renderJlpt(); }).catch(() => {});
  if (!grammarPoints()) ensureGrammarPoints().then(() => { if (panelActive()) renderJlpt(); }).catch(() => {});
  // The MCQ bank is its own chunk; kick it too so the 文法形式判断 CTA appears without a click.
  if (!grammarMcq()) ensureGrammarMcq().then(() => { if (panelActive()) renderJlpt(); }).catch(() => {});
}

/* ---- delegated wiring (attach once) ----------------------------------------------- */

const ACTIONS = {
  level: (el) => { state.jlptStore.level = el.dataset.level; saveJlpt(); renderJlpt(); },
  task: (el) => {
    const id = el.dataset.task, today = localDay();
    const days = state.jlptStore.days;
    const rec = days[today] || (days[today] = {});
    if (rec[id]) delete rec[id]; else rec[id] = 1;
    if (!Object.keys(rec).length) delete days[today];
    saveJlpt(); renderJlpt();
  },
  'go-due': () => { goTab('study'); startDueSession(); },
  'go-leeches': () => studyLeechCards(),
  'go-grammar': () => { goTab('browse'); openBrowseGrammar(); },
  'go-wanikani': () => goTab('wanikani'),
  'go-selftalk': () => goTab('selftalk'),
  'go-songs': () => goTab('songs'),
  'go-minna': () => goTab('minna'),
  // ---- pacing coach + grammar lens ----
  // Add today's gap-fill batch: recompute the gap FRESH at click time (the render's copy
  // may be minutes old), tier-select up to the remaining quota, bulk-add, confirm.
  'gap-add': async (el) => {
    if (el) el.disabled = true;
    const level = state.jlptStore.level;
    const [words] = await Promise.all([ensureJlptWords(level), ensureJlptMap()]);
    const map = jlptMap();
    if (!words || !map) { renderJlpt(); return; }
    // Re-derive the gap/pace FRESH at click time (the render's copy may be minutes old) — the
    // shared code, not the shared result (see deriveGapContext).
    const { wkIdx, wkLevel, gap, targets, pace } = deriveGapContext(level, map, localDay());
    const n = Math.max(0, targets.wordsPerDay - pace.today) || targets.wordsPerDay;
    const added = addJlptWords(selectGapBatch(words, gap.uncovered, wkIdx, wkLevel || 0, n), level);
    setSyncStatus(added ? `✚ ${added} ${level} word${added === 1 ? '' : 's'} added to the deck` : 'nothing new to add');
    renderJlpt();
  },
  'study-jlpt': () => studyJlptCards(),
  'go-grammar-drill': () => studyGrammarDeck(),
  'gp-add': async (el) => {
    const pts = await ensureGrammarPoints();
    const p = pts.find((x) => x.id === el.dataset.point);
    if (p) activateGrammarPoints([p]);
    renderJlpt();
  },
  'gp-add-all': async () => {
    const added = activateGrammarPoints(await ensureGrammarPoints());
    setSyncStatus(added ? `✚ ${added} grammar point${added === 1 ? '' : 's'} added as cloze cards` : 'all points already in the deck');
    renderJlpt();
  },
  'gp-detail': (el) => {
    const v = state.DATA.find((x) => x.rank === Number(el.dataset.rank));
    if (v) openVerbDetail(v);
  },
  // ---- 文法形式判断 MCQ drill (jlpt/mcq.js) ----
  ...MCQ_ACTIONS,
  // ---- mock-test log (jlpt/mocks.js) ----
  ...MOCK_ACTIONS,
};

export function wireJlpt() {
  const panel = document.getElementById('panel-jlpt');
  if (!panel || panel.dataset.jlWired) return;
  panel.dataset.jlWired = '1';
  closeMockForm(); closeMcq();   // a freshly-wired panel starts clean (once at boot; per-panel in tests)
  panel.addEventListener('click', (e) => {
    const el = e.target.closest('[data-jl-act]');
    if (!el || el.disabled) return;
    const fn = ACTIONS[el.dataset.jlAct];
    if (fn) fn(el, e);
  });
  // Mirror every mock-form keystroke into S.mockDraft (see the S declaration): an async
  // re-render must not eat a half-typed sitting. Nothing is persisted here — only `mock-save`
  // writes the blob.
  panel.addEventListener('input', (e) => { captureMockField(e.target); });
  // The exam-date input + the two pacing-target steppers commit on change; the re-render
  // reflows the countdown / the pace verdicts. Out-of-range target input just re-renders
  // back to the stored value (normalizeJlpt's 1..99 clamp is the source of truth).
  // NOTE the ordering trap: a `change` on a mock-form field must NOT fall into the target
  // branch below (it doesn't — those match by id) and must not re-render (it would blur the
  // field mid-entry), so the mock form is deliberately absent from this handler.
  panel.addEventListener('change', (e) => {
    if (e.target.id === 'jlptDate') {
      const v = e.target.value;
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { state.jlptStore.examDate = v; saveJlpt(); renderJlpt(); }
      return;
    }
    if (e.target.id === 'jlptTargetWords' || e.target.id === 'jlptTargetGrammar') {
      const key = e.target.id === 'jlptTargetWords' ? 'wordsPerDay' : 'grammarPerWeek';
      const v = Math.round(Number(e.target.value));
      if (Number.isFinite(v) && v >= 1 && v <= 99) {
        (state.jlptStore.targets || (state.jlptStore.targets = {}))[key] = v;
        saveJlpt();
      }
      renderJlpt();
    }
  });
}
