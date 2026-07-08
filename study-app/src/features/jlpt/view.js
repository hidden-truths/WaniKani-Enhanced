// 合格 JLPT tab — render + the attach-once delegated wiring (the songs/wanikani ACTIONS
// pattern). The tab is MISSION CONTROL for the exam goal: countdown hero, the daily
// training checklist (auto-checked from live app signals where a signal exists, manual
// elsewhere; per-day record synced in the 'jlpt' blob), the vocabulary-readiness lens
// (deck + WaniKani coverage of the target level via the bundled JLPT list), and the
// four exam sections mapped onto the app surfaces that train them. All derivation is
// core/jlpt.js; signals come from the same stores the other tabs already keep.
import { state } from '../../state.js';
import { localDay } from '../../config.js';
import {
  deckJlptCoverage, wkJlptCoverage,
  escapeHtml, selectGapBatch,
  mcqQuestionCount,
} from '../../core/index.js';
import { jlptMap, ensureJlptMap, jlptWords, ensureJlptWords } from './data.js';
import { addJlptWords, jlptDeckCount } from './activate.js';
import { grammarPoints, ensureGrammarPoints, activateGrammarPoints, grammarDeckCount, grammarMcq, ensureGrammarMcq } from '../grammar/index.js';
import { saveJlpt } from './store.js';
import { setSyncStatus } from '../cloud-core.js';
import { startDueSession, studyLeechCards, studyGrammarDeck, studyJlptCards } from '../deck.js';
import { openBrowseGrammar, openVerbDetail } from '../browse.js';
import { S as WK } from '../wanikani/state.js';
// View-only state + the panel-active / tab-jump helpers (jlpt/state.js — refactor step 1).
import { S, closeMockForm, closeMcq, MCQ_QUIZ_LEN, panelActive, goTab } from './state.js';
import { sectionsHtml } from './sections.js';   // the four-papers grid (refactor step 2)
import { mockLogHtml, captureMockField, MOCK_ACTIONS } from './mocks.js';   // 模試 log (refactor step 3)
import { mcqWeakIds, mcqBadge, mcqHtml, MCQ_ACTIONS } from './mcq.js';   // 文法形式判断 drill (refactor step 4)
import { collectSignals, deriveGapContext } from './signals.js';   // the live-signal read (refactor step 5)
import { buildTasks, persistDone, checklistHtml } from './checklist.js';   // daily checklist (refactor step 6)
import { headHtml, heroHtml } from './hero.js';   // head + countdown hero (refactor step 7a)

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

function readinessHtml(store, sig) {
  const map = jlptMap();
  const level = store.level;
  let vocab;
  if (!map) {
    vocab = `<div class="jl-empty">loading the ${level} word list…</div>`;
  } else {
    const deck = deckJlptCoverage(map, level, state.DATA, state.store.cards);
    const wk = sig.wkLoaded ? wkJlptCoverage(map, level, WK.subjects, WK.assignments) : null;
    const bar = (label, num, denom, hi, hiLabel) => {
      const pct = denom ? Math.round((100 * num) / denom) : 0;
      const hiPct = denom ? Math.round((100 * hi) / denom) : 0;
      return `<div class="jl-covrow"><span class="jl-cov-label">${label}</span>
        <span class="jl-covtrack"><span class="jl-covfill hi" style="width:${hiPct}%"></span><span class="jl-covfill" style="width:${pct}%"></span></span>
        <b class="jl-covval">${num.toLocaleString()}</b></div>
        <div class="jl-covsub">${hi.toLocaleString()} ${hiLabel} · of ${denom.toLocaleString()} ${level} words</div>`;
    };
    vocab = bar('In your deck', deck.inDeck, deck.total, deck.solid, 'solid (box 4+)')
      + (wk
        ? bar('On WaniKani', wk.started, wk.total, wk.guru, 'at Guru or beyond')
        : `<div class="jl-covsub">${sig.wkConnected ? 'loading WaniKani data…' : `<button class="jl-link" data-jl-act="go-wanikani">Connect WaniKani</button> to see how much ${level} vocabulary your reviews already cover.`}</div>`)
      + gapFillHtml(store, sig);
  }
  const momentum = `
    <div class="jl-statgrid">
      <div class="jl-stat"><b>${sig.weekReviews.toLocaleString()}</b><span>reviews · last 7 days</span></div>
      <div class="jl-stat"><b>${sig.reviewedToday}</b><span>reviews today</span></div>
      <div class="jl-stat${sig.appLeeches ? ' warn' : ''}"><b>${sig.appLeeches}</b><span>deck leeches</span></div>
      <div class="jl-stat${sig.wkLeeches ? ' warn' : ''}"><b>${sig.wkLeeches == null ? '—' : sig.wkLeeches}</b><span>WK leeches</span></div>
    </div>
    <div class="jl-covsub">steady beats heroic: ~${Math.max(20, Math.ceil(sig.weekReviews / 7))} reviews a day holds the pipeline${sig.appLeeches ? ` · <button class="jl-link" data-jl-act="go-leeches">drill the leeches</button>` : ''}</div>`;
  return `<div class="jl-two">
    <section class="jl-card"><div class="jl-card-head"><div><h2 class="title">${level} vocabulary coverage</h2>
      <div class="sub">the bundled JLPT list, matched against what you already study</div></div></div>${vocab}</section>
    <section class="jl-card"><div class="jl-card-head"><div><h2 class="title">Momentum</h2>
      <div class="sub">volume + trouble spots — the two dials that matter weekly</div></div></div>${momentum}</section>
  </div>`;
}

// The gap-fill block inside the vocabulary-coverage card: the honest union line (a word
// counts as covered when it's in the deck OR Guru+ on WK — the overlap shown once), a
// 3-word preview of today's batch (tier-ordered: words WK will never teach come first),
// and the one-tap add. "Study them now" appears once any gap-fill cards exist.
function gapFillHtml(store, sig) {
  const gap = sig.gap;
  if (!gap) return '';
  const union = `<div class="jl-covsub jl-union">covered either way: <b>${gap.covered.toLocaleString()}</b> of ${gap.total.toLocaleString()} — ${gap.inDeck.toLocaleString()} in deck · ${gap.guru.toLocaleString()} Guru+ on WK · ${gap.both.toLocaleString()} both</div>`;
  if (!gap.uncovered.length) return `${union}<div class="jl-gapfill"><div class="jl-covsub">nothing uncovered — every ${store.level} list word is in play 🎉</div></div>`;
  const words = jlptWords(store.level);
  if (!words) return `${union}<div class="jl-gapfill"><div class="jl-covsub">loading the enriched ${store.level} entries…</div></div>`;
  const remainingToday = Math.max(0, sig.targets.wordsPerDay - sig.pace.today);
  const n = remainingToday || sig.targets.wordsPerDay;
  const preview = selectGapBatch(words, gap.uncovered, sig.wkIdx, sig.wkLevel || 0, 3)
    .map((e) => `<span class="jl-gap-w jp" title="${escapeHtml(e[2])}">${escapeHtml(e[0])}</span>`).join('');
  // Only show "+N more" when there ARE more than the 3 previewed — near a level's tail (1–2 left)
  // the old unconditional `length - 3` rendered "+-2 more".
  const more = gap.uncovered.length > 3
    ? `<span class="jl-gap-more">+${(gap.uncovered.length - 3).toLocaleString()} more, hardest-to-meet first</span>`
    : '';
  const deckN = jlptDeckCount();
  return `${union}<div class="jl-gapfill">
    <div class="jl-gap-row">${preview}${more}</div>
    <div class="jl-gap-row">
      <button class="chip primary jl-go" data-jl-act="gap-add">${remainingToday ? `Add today's ${n}` : `Add ${n} more`}</button>
      ${deckN.n ? `<button class="chip jl-go" data-jl-act="study-jlpt">Study them now${deckN.due ? ` · ${deckN.due} due` : ''}</button>` : ''}
    </div>
  </div>`;
}

// The grammar-readiness lens: catalog coverage bars + the per-point list (status pip ·
// pattern · gloss · Add/Read) behind a disclosure, with Add-all + Drill CTAs. The catalog
// is N3 content (the exam's zero-coverage paper); it renders regardless of target level.
function grammarLensHtml(store, sig) {
  const points = grammarPoints();
  // While a drill runs the card BECOMES the drill: its title/sub describe the MCQ, and the lens CTAs
  // (Add-all / cloze Drill) are withheld — they'd re-render the deck out from under a live question.
  const head = (extra, title, sub) => `<section class="jl-card jl-grammar" id="jlGrammarLens">
    <div class="jl-card-head"><div><h2 class="title">${title || 'N3 grammar'}</h2>
      <div class="sub">${sub || 'the pattern catalog, drilled as cloze cards in your deck'}</div></div>${extra || ''}</div>`;
  if (!points) return `${head()}<div class="jl-empty">loading the grammar catalog…</div></section>`;
  const cov = sig.gcov;
  const byId = new Map(points.map((p) => [p.id, p]));
  const remaining = cov.total - cov.inDeck;
  const gcount = grammarDeckCount();
  // The MCQ CTA is offered whenever a bank exists for at least one point — it drills RECOGNITION and
  // needs no deck cards, unlike the cloze "Drill grammar" path which needs activated cards.
  const bank = grammarMcq();
  const nq = bank ? mcqQuestionCount(bank) : 0;
  // The 苦手 CTA only appears once the trail actually knows something — it draws from the points
  // you've drilled and keep missing, not from the whole bank.
  const weakIds = mcqWeakIds();
  const ctas = `<div class="jl-gp-ctas">
    ${remaining ? `<button class="chip primary jl-go" data-jl-act="gp-add-all">Add all ${remaining}</button>` : ''}
    ${gcount.n ? `<button class="chip jl-go" data-jl-act="go-grammar-drill">Drill grammar${gcount.due ? ` · ${gcount.due} due` : ''}</button>` : ''}
    ${nq && !S.mcq ? `<button class="chip jl-go" data-jl-act="mcq-start" title="Fill-the-blank, four choices — the exam's grammar question">文法形式判断 · ${Math.min(nq, MCQ_QUIZ_LEN)} Q</button>` : ''}
    ${weakIds.length && !S.mcq ? `<button class="chip jl-go jl-weak" data-jl-act="mcq-weak" title="Only the patterns you keep getting wrong">苦手 · ${weakIds.length}</button>` : ''}
  </div>`;
  const pct = cov.total ? Math.round((100 * cov.inDeck) / cov.total) : 0;
  const solidPct = cov.total ? Math.round((100 * cov.solid) / cov.total) : 0;
  const bar = `<div class="jl-covrow"><span class="jl-cov-label">In your deck</span>
    <span class="jl-covtrack"><span class="jl-covfill hi" style="width:${solidPct}%"></span><span class="jl-covfill" style="width:${pct}%"></span></span>
    <b class="jl-covval">${cov.inDeck}</b></div>
    <div class="jl-covsub">${cov.solid} solid (box 4+) · ${cov.learning} learning · of ${cov.total} points</div>`;
  const trail = (state.jlptStore || {}).mcq || {};
  const rows = cov.points.map((p) => {
    const pt = byId.get(p.id);
    if (!pt) return '';
    const act = p.rank == null
      ? `<button class="chip jl-go sm" data-jl-act="gp-add" data-point="${escapeHtml(p.id)}">Add</button>`
      : `<button class="chip jl-go sm" data-jl-act="gp-detail" data-rank="${p.rank}">Read</button>`;
    // The pip is the CLOZE-card status (deck/SRS); the badge is the MCQ trail (recognition). Two
    // different skills over one point — deliberately shown side by side, never merged.
    return `<div class="jl-gp-row"><span class="jl-gp-pip ${p.status}" title="${p.status}"></span>
      <span class="jl-gp-label jp">${escapeHtml(pt.label)}</span><span class="jl-gp-mean">${escapeHtml(pt.mean)}</span>${mcqBadge(trail, p.id)}${act}</div>`;
  }).join('');
  if (S.mcq) {                                               // a live drill owns the card
    return `${head('', '<span class="jp-min">文法形式判断</span> · Grammar MCQ',
      S.mcq.weak
        ? 'drawn from the patterns you keep getting wrong'
        : "fill the blank — four patterns you almost know, the shape the exam actually asks")}${mcqHtml()}</section>`;
  }
  return `${head(ctas)}${bar}
    <details class="jl-gp-list"><summary>All ${cov.total} points</summary><div class="jl-gp-rows">${rows}</div></details>
  </section>`;
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
