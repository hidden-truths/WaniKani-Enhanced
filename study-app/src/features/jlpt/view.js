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
  dueCards, leeches, studyStreak, practiceStreak,
  examCountdown, deckJlptCoverage, wkJlptCoverage, checklistHeat, shiftDay,
  wkForecast, JLPT_LEVEL_ORDER, escapeHtml,
  jlptTargets, deckWordSet, wkVocabIndex, jlptGap, selectGapBatch, weeklyAddPace, pacePlan,
  grammarCoverage, grammarReviewedToday,
  MOCK_SECTIONS, MOCK_LEVELS, MOCK_PASS, MOCK_MAX_TOTAL, normalizeMock, normalizeMocks,
  mockVerdict, mockTrend,
  buildMcqQuiz, splitStem, scoreMcq, weakPoints, mcqQuestionCount,
  mcqPointIds, applyMcqResult, mcqStat, weakestMcqPoints,
} from '../../core/index.js';
import { jlptMap, ensureJlptMap, jlptWords, ensureJlptWords, cardJlptLevel } from './data.js';
import { addJlptWords, jlptDeckCount } from './activate.js';
import { grammarPoints, ensureGrammarPoints, activateGrammarPoints, grammarDeckCount, grammarMcq, ensureGrammarMcq } from '../grammar/index.js';
import { saveJlpt } from './store.js';
import { setSyncStatus } from '../cloud-core.js';
import { startDueSession, studyLeechCards, studyGrammarDeck, studyJlptCards } from '../deck.js';
import { openBrowseGrammar, openVerbDetail } from '../browse.js';
import { S as WK } from '../wanikani/state.js';
import { leechList } from '../wanikani/leeches.js';
// View-only state + the panel-active / tab-jump helpers (jlpt/state.js — refactor step 1).
import { S, closeMockForm, closeMcq, MCQ_QUIZ_LEN, MCQ_WEAK, panelActive, goTab } from './state.js';
import { sectionsHtml } from './sections.js';   // the four-papers grid (refactor step 2)

/* ---- live signals ------------------------------------------------------------ */

// One read over the app's stores → everything the checklist + readiness cards show.
// WK numbers are null when no token / dataset not yet in memory (ensureWkData is kicked
// on tab open; onWkData re-renders when it lands).
function collectSignals() {
  const today = localDay();
  const store = state.jlptStore;
  const daily = state.store.daily || {};
  let week = 0;
  for (let i = 0; i < 7; i++) { const d = daily[shiftDay(today, -i)]; if (d) week += d.tot || 0; }
  const wkConnected = !!state.wanikaniStore.token;
  const wkLoaded = wkConnected && WK.loaded;
  // Pacing coach inputs: the coverage gap (deck ∪ WK-guru vs the list), the deck-add pace (the
  // `added` day-stamps, from EVERY vocab source — gap-fill / 鰐蟹 / 歌 / みんなの日本語 — levelled by the
  // authoritative word list, not the card's own guessed `jlpt`), the grammar catalog coverage, and
  // the user targets — all fed to the pure pacePlan. gap/plan are null until the word-list chunk lands.
  const wkIdx = wkLoaded ? wkVocabIndex(WK.subjects, WK.assignments) : null;
  const wkLevel = wkLoaded && WK.user ? WK.user.level : null;
  const map = jlptMap();
  const gap = map ? jlptGap(map, store.level, deckWordSet(state.DATA), wkIdx) : null;
  const targets = jlptTargets(store);
  const pace = weeklyAddPace(state.DATA, today, store.level, { levelOf: cardJlptLevel });
  const points = grammarPoints();
  const gcov = points ? grammarCoverage(points, state.DATA, state.store.cards) : null;
  const cd = examCountdown(store.examDate, Date.now());
  const plan = gap && cd && !cd.past
    ? pacePlan({ daysLeft: cd.days, gap, targets, grammar: gcov ? { studied: gcov.inDeck, total: gcov.total } : null })
    : null;
  return {
    today,
    level: store.level,
    due: dueCards().length,
    reviewedToday: (daily[today] && daily[today].tot) || 0,
    weekReviews: week,
    streak: studyStreak(daily, today),
    appLeeches: leeches().length,
    speakStreak: practiceStreak(state.selftalkStore.practice, today),
    spokeToday: (state.selftalkStore.practice || {}).lastDay === today,
    lastLesson: state.minnaStore.lastLesson,
    wkConnected, wkLoaded, wkIdx,
    wkReviewsNow: wkLoaded ? wkForecast([...WK.assignments.values()], Date.now()).availableNow : null,
    wkLessons: wkLoaded && WK.summary ? WK.summary.lessons : null,
    wkLeeches: wkLoaded ? leechList().length : null,
    wkLevel,
    gap, targets, pace, gcov, plan,
    grammarToday: grammarReviewedToday(state.DATA, state.store.cards, new Date(today + 'T00:00').getTime()),
    hasGrammarCards: state.DATA.some((v) => v && v.grammar),
  };
}

/* ---- the daily checklist ------------------------------------------------------- */

// Task model: { id, jp, title, sub, done, auto, checkable, act?, actLabel?, href? }.
// AUTO tasks read a live signal (done can't be un-ticked — the signal owns it); MANUAL
// tasks toggle a per-day flag in the synced blob. Auto-done states are written THROUGH
// to the day record (persistDone) so the heatmap history is a plain record.
function buildTasks(sig, dayRec) {
  const t = [];
  if (sig.wkConnected) {
    const n = sig.wkReviewsNow;
    t.push({
      id: 'wkrev', jp: '亀', title: 'Clear WaniKani reviews', auto: true,
      done: n === 0,
      sub: n == null ? 'checking your WaniKani queue…' : (n === 0 ? 'queue clear — nothing waiting' : `${n} waiting${sig.wkLessons ? ` · ${sig.wkLessons} lessons ready` : ''}`),
      href: n ? 'https://www.wanikani.com/subjects/review' : null, actLabel: 'Review on WK',
    });
  } else {
    t.push({
      id: 'wkrev', jp: '亀', title: 'Clear WaniKani reviews', auto: true, done: false, unavailable: true,
      sub: 'connect your WaniKani account to track this automatically',
      act: 'go-wanikani', actLabel: 'Connect',
    });
  }
  t.push({
    id: 'due', jp: '復', title: 'Review due flashcards', auto: true,
    done: sig.due === 0,
    sub: sig.due === 0
      ? `all caught up${sig.reviewedToday ? ` · ${sig.reviewedToday} reviewed today` : ''}`
      : `${sig.due} due in your deck${sig.reviewedToday ? ` · ${sig.reviewedToday} done today` : ''}`,
    act: sig.due ? 'go-due' : null, actLabel: 'Start review',
  });
  // AUTO — the quota row's live signal is the `added` day-stamps on the cards (a real, re-readable
  // signal, unlike listening); write-through via persistDone like the others. Every vocab source
  // stamps it, so adding N3 words from 鰐蟹 / 歌 / みんなの日本語 fills the quota just as gap-fill does.
  {
    const uncov = sig.gap ? sig.gap.uncovered.length : null;
    const target = sig.targets.wordsPerDay;
    t.push({
      id: 'vocab', jp: '語', title: `Add new ${sig.level} words`, auto: true,
      done: uncov === 0 || sig.pace.today >= target,
      sub: uncov == null ? `loading the ${sig.level} word list…`
        : uncov === 0 ? 'the whole list is covered — nothing left to add'
          : `${sig.pace.today}/${target} added today · ${uncov.toLocaleString()} uncovered`,
      act: uncov ? 'gap-add' : null, actLabel: 'Add words',
    });
  }
  t.push({
    id: 'leech', jp: '虫', title: 'Drill your leeches', auto: sig.appLeeches === 0,
    done: sig.appLeeches === 0 ? true : !!dayRec.leech,
    checkable: sig.appLeeches > 0,
    sub: sig.appLeeches === 0
      ? 'no active leeches — clean slate'
      : `${sig.appLeeches} in the deck${sig.wkLeeches ? ` · ${sig.wkLeeches} on WaniKani` : ''} — a short worst-first round`,
    act: sig.appLeeches ? 'go-leeches' : (sig.wkLeeches ? 'go-wanikani' : null), actLabel: sig.appLeeches ? 'Drill now' : 'WK leeches',
  });
  t.push({
    id: 'speak', jp: '声', title: 'Speak out loud (独り言)', auto: true,
    done: sig.spokeToday,
    sub: sig.spokeToday
      ? `practiced today${sig.speakStreak > 1 ? ` · day ${sig.speakStreak} streak` : ''}`
      : (sig.speakStreak ? `day ${sig.speakStreak} streak on the line — a few phrases keep it` : 'a few phrases, out loud — output is what the exam can\'t test but N3 conversation needs'),
    act: 'go-selftalk', actLabel: 'Practice',
  });
  t.push({
    id: 'listen', jp: '聴', title: 'Listening reps (歌)', auto: false,
    done: !!dayRec.listen, checkable: true,
    sub: 'one song — dictate a few lines in Listen, or shadow them',
    act: 'go-songs', actLabel: 'Open 歌',
  });
  // CONDITIONALLY AUTO (the leech-row precedent): once grammar cloze cards are in the deck
  // there IS a live signal (a grammar card graded today — the `last` stamp), so the row
  // tracks itself; before that it stays a manual tick with a nudge toward the lens.
  if (sig.hasGrammarCards) {
    const g = sig.gcov;
    t.push({
      id: 'grammar', jp: '法', title: 'One grammar point', auto: true,
      done: sig.grammarToday,
      sub: sig.grammarToday
        ? 'grammar drilled today'
        : `a cloze round keeps the ${sig.targets.grammarPerWeek}/week pace${g ? ` · ${g.inDeck}/${g.total} points in the deck` : ''}`,
      act: 'go-grammar-drill', actLabel: 'Drill',
    });
  } else {
    t.push({
      id: 'grammar', jp: '法', title: 'One grammar point', auto: false,
      done: !!dayRec.grammar, checkable: true,
      sub: 'add N3 grammar points below to drill them here — this row then tracks itself',
      act: 'gp-add-all', actLabel: 'Add grammar',
    });
  }
  t.push({
    id: 'text', jp: '本', title: 'Textbook time (教科書)', auto: false,
    done: !!dayRec.text, checkable: true,
    sub: sig.lastLesson ? `continue みんなの日本語 L${sig.lastLesson}` : 'a lesson chunk of みんなの日本語 — grammar + reading in one',
    act: 'go-minna', actLabel: 'Open 教科書',
  });
  return t;
}

// Write auto-done states through to today's record so history (heatmap) is plain data.
// Saves (debounced push) only when something actually flipped.
function persistDone(tasks, today) {
  const days = state.jlptStore.days;
  const rec = days[today] || {};
  let changed = false;
  for (const task of tasks) {
    if (task.done && !task.unavailable && !rec[task.id]) { rec[task.id] = 1; changed = true; }
  }
  if (changed) { days[today] = rec; saveJlpt(); }
}

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

function headHtml(store) {
  const chips = JLPT_LEVEL_ORDER.map((l) =>   // easy → hard, matching every other JLPT segment in the app
    `<button class="jl-levelchip${l === store.level ? ' active' : ''}" data-jl-act="level" data-level="${l}">${l}</button>`).join('');
  return `<div class="marker"><div class="idx">04<span class="slash"> / 08</span></div><div class="ttl jp-min">合格</div><div class="en">JLPT</div><div class="rule"></div></div>
  <section class="page-head">
    <div>
      <h1 class="page-title">Road to ${store.level} <span class="jl-title-jp jp-min">合格</span></h1>
      <div class="jl-sub">the whole app, pointed at one date — do the list, trust the reps</div>
    </div>
    <div class="page-counts"><span class="jl-levelseg" role="group" aria-label="Target JLPT level">${chips}</span></div>
  </section>`;
}

function heroHtml(store, sig, tasks) {
  const cd = examCountdown(store.examDate, Date.now());
  const counted = tasks.filter((t) => !t.unavailable);
  const done = counted.filter((t) => t.done).length;
  const pct = counted.length ? done / counted.length : 0;
  const R = 34, C = 2 * Math.PI * R;
  const examLabel = cd ? new Date(store.examDate + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : '';
  const big = !cd ? '—' : (cd.past ? '済' : cd.days);
  const subline = !cd ? 'set your exam date' : cd.past
    ? 'that exam day has passed — set the next sitting'
    : `${cd.weeks} week${cd.weeks === 1 ? '' : 's'}${cd.restDays ? ` and ${cd.restDays} day${cd.restDays === 1 ? '' : 's'}` : ''} to go — steady beats cramming`;
  return `<section class="jl-hero">
    <div class="jl-hero-left">
      <div class="jl-count"><b class="jl-days">${big}</b><span class="jl-days-label">day${cd && cd.days === 1 ? '' : 's'} <em>until the ${store.level}</em></span></div>
      <div class="jl-hero-meta">
        <span class="jl-examdate">${examLabel}</span>
        <label class="jl-dateedit" title="Change the exam date"><svg class="ic" aria-hidden="true"><use href="#i-edit"/></svg><input type="date" id="jlptDate" value="${store.examDate}" aria-label="Exam date"></label>
      </div>
      <div class="jl-hero-sub">${subline}</div>
      ${paceHtml(store, sig)}
      <div class="jl-hero-pills">
        ${sig.streak ? `<span class="pill"><span class="dot"></span><b>Day ${sig.streak}</b>&nbsp;review streak</span>` : ''}
        ${sig.speakStreak ? `<span class="pill"><span class="dot speak"></span><b>Day ${sig.speakStreak}</b>&nbsp;speaking</span>` : ''}
        ${sig.wkLevel ? `<span class="pill"><span class="dot wk"></span>WK&nbsp;<b>level ${sig.wkLevel}</b></span>` : ''}
        ${mockPillHtml(store)}
      </div>
    </div>
    <div class="jl-hero-ring" role="img" aria-label="${done} of ${counted.length} daily tasks done">
      <svg viewBox="0 0 84 84">
        <circle class="jl-ring-track" cx="42" cy="42" r="${R}"/>
        <circle class="jl-ring-fill${pct >= 1 ? ' full' : ''}" cx="42" cy="42" r="${R}"
          stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - pct)).toFixed(1)}"/>
      </svg>
      <div class="jl-ring-center"><b>${done}<span>/${counted.length}</span></b><em>today</em></div>
    </div>
  </section>`;
}

// The latest same-level mock, surfaced beside the streaks: the one hero number that answers
// "would I pass today". Absent until a mock is logged (the pills row is already conditional).
function mockPillHtml(store) {
  const trend = mockTrend(store.mocks, store.level);
  if (!trend) return '';
  const v = mockVerdict(trend.latest);
  return `<span class="pill mock ${v.pass ? 'pass' : 'fail'}" title="latest ${store.level} mock, ${trend.latest.date}"><span class="dot mock"></span>Mock&nbsp;<b>${trend.latest.total}</b>&nbsp;/&nbsp;${MOCK_MAX_TOTAL}</span>`;
}

// The pacing strip: what closing the vocab gap by the exam date actually requires, vs the
// user's editable daily target and their real add-pace this week. Grammar mirrors it weekly.
// Hidden until the word-list chunk lands (plan is null) or when no exam date is set.
function paceHtml(store, sig) {
  const plan = sig.plan;
  if (!plan) return '';
  const verdict = plan.verdict === 'behind'
    ? { cls: 'warn', label: `≈${Math.abs(plan.slackWeeks)} wk behind` }
    : plan.verdict === 'ahead' ? { cls: 'good', label: `≈${plan.slackWeeks} wk of slack` }
      : plan.verdict === 'done' ? { cls: 'good', label: 'vocab gap closed' }
        : { cls: 'good', label: 'on track' };
  const g = plan.grammar;
  return `<div class="jl-pace">
    <div class="jl-pace-row">
      <span class="jl-pace-verdict ${verdict.cls}">${verdict.label}</span>
      <span class="jl-pace-line">≈<b>${plan.neededPerDay}</b> new words/day closes the ${plan.uncovered.toLocaleString()}-word ${store.level} gap by exam day (2-week review buffer) · added <b>${sig.pace.week}</b> this week</span>
      <label class="jl-pace-target">target <input type="number" id="jlptTargetWords" min="1" max="99" value="${sig.targets.wordsPerDay}" aria-label="New words per day target">/day</label>
    </div>
    ${g ? `<div class="jl-pace-row">
      <span class="jl-pace-verdict ${g.verdict === 'behind' ? 'warn' : 'good'}">${g.verdict === 'done' ? 'grammar covered' : g.verdict === 'behind' ? 'grammar behind' : 'grammar on pace'}</span>
      <span class="jl-pace-line">grammar: <b>${g.remaining}</b> point${g.remaining === 1 ? '' : 's'} left · ≈${g.neededPerWeek}/week needed</span>
      <label class="jl-pace-target">target <input type="number" id="jlptTargetGrammar" min="1" max="99" value="${sig.targets.grammarPerWeek}" aria-label="Grammar points per week target">/wk</label>
    </div>` : ''}
  </div>`;
}

function checklistHtml(store, sig, tasks) {
  const rows = tasks.map((t) => {
    const check = t.unavailable
      ? `<span class="jl-check off" aria-hidden="true"></span>`
      : t.checkable
        ? `<button class="jl-check${t.done ? ' on' : ''}" data-jl-act="task" data-task="${t.id}" role="checkbox" aria-checked="${t.done}" aria-label="${t.title}">${t.done ? '<svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>' : ''}</button>`
        : `<span class="jl-check auto${t.done ? ' on' : ''}" title="tracked automatically">${t.done ? '<svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>' : ''}</span>`;
    const action = t.href
      ? `<a class="chip jl-go" href="${t.href}" target="_blank" rel="noopener">${t.actLabel}<svg class="ic" aria-hidden="true"><use href="#i-external"/></svg></a>`
      : t.act
        ? `<button class="chip jl-go" data-jl-act="${t.act}">${t.actLabel}<svg class="ic" aria-hidden="true"><use href="#i-arrow-right"/></svg></button>`
        : '';
    return `<div class="jl-task${t.done ? ' done' : ''}${t.unavailable ? ' unavailable' : ''}">
      ${check}
      <span class="jl-task-jp jp-min" aria-hidden="true">${t.jp}</span>
      <div class="jl-task-main"><b>${t.title}</b><span class="jl-task-sub">${t.sub}</span></div>
      ${action}
    </div>`;
  }).join('');
  const heat = checklistHeat(store.days, sig.today, 14, tasks.filter((t) => !t.unavailable).length);
  const cells = heat.map((h) => {
    const lvl = h.done === 0 ? 0 : h.frac < 0.34 ? 1 : h.frac < 0.67 ? 2 : h.frac < 1 ? 3 : 4;
    const d = new Date(h.day + 'T12:00');
    return `<span class="jl-heatcell l${lvl}" title="${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: ${h.done} task${h.done === 1 ? '' : 's'}"></span>`;
  }).join('');
  return `<section class="jl-card jl-checklist">
    <div class="jl-card-head"><div><h2 class="title"><span class="jp-min">今日の稽古</span> · Today's training</h2>
      <div class="sub">auto rows track the app; tick the rest yourself — the record syncs</div></div></div>
    <div class="jl-tasks">${rows}</div>
    <div class="jl-heat"><span class="jl-heat-label">last 14 days</span>${cells}</div>
  </section>`;
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

/* ---- 文法形式判断: the wave-2 MCQ drill ---------------------------------------------
   The cloze card asks you to PRODUCE a pattern; the exam asks you to RECOGNISE the right one out of
   four you almost know. Different skill, so it gets its own bank (data/grammar-n3-mcq.js, a lazy
   sibling chunk) and its own drill — keyed on the same durable point ids, so a point's cloze card
   and its MCQ questions always refer to one thing.

   The drill lives INSIDE the grammar lens rather than in the flashcard session: it isn't SRS (no
   scheduling, no leech math), it's a recognition sitting you take on demand. The RUN isn't
   persisted, but each ANSWER is: `mcq-pick` writes through to the per-point score trail on the
   synced `jlpt` blob (store.mcq), which is what the lens badges and the 苦手 drill read. */

// The points the 苦手 drill would draw from: weak by the trail AND actually banked (a pattern with no
// questions can't be drilled, however badly you know it).
function mcqWeakIds() {
  const bank = grammarMcq();
  if (!bank) return [];
  return weakestMcqPoints((state.jlptStore || {}).mcq, mcqPointIds(bank), MCQ_WEAK);
}

// A point's lifetime MCQ record as a compact badge — omitted entirely for a point never drilled, so
// the lens doesn't sprout 81 "0/0"s.
//
// `.weak` re-derives the threshold instead of intersecting with mcqWeakIds(), and that is deliberate:
// a trail entry can only EXIST for a banked point (`mcq-pick` keys the trail on `q.pointId`, which
// buildMcqQuiz takes from the bank), so "weak by the trail" already implies "banked" — and gating on
// grammarMcq() here would blank every badge until the lazy bank chunk lands. The one case where the
// badge and the 苦手 drill can disagree is a point DROPPED from the bank after you drilled it: it
// keeps a stale `.weak` tint with no drill that can clear it. Acceptable while the bank only grows
// (10/81 points today). If points ever start leaving the bank, intersect here.
//
// The threshold itself (an ACCURACY floor, never `wrong > 0`) is a documented dead-end — see the MCQ
// entry in study-app/CLAUDE.md. Lifetime counters mean "ever missed" would pin a point forever.
function mcqBadge(trail, id) {
  const s = mcqStat(trail, id);
  if (!s) return '';
  const weak = s.seen >= MCQ_WEAK.minSeen && s.wrong > 0 && s.pct < MCQ_WEAK.maxPct;
  return `<span class="jl-gp-mcq${weak ? ' weak' : ''}" title="文法形式判断: ${s.right} of ${s.seen} correct${s.last ? ` · last ${s.last}` : ''}">${s.right}<i>/${s.seen}</i></span>`;
}

// Assemble + open a run. `ids` empty/absent = draw from every banked point; pass weak ids for the
// 苦手 drill. Awaits the lazy bank chunk, so the first click after a cold boot still works.
async function startMcq(ids) {
  const bank = await ensureGrammarMcq().catch(() => null);
  if (!bank) return;
  const questions = buildMcqQuiz(bank, { ids, n: MCQ_QUIZ_LEN });
  if (!questions.length) return;
  S.mcq = { questions, i: 0, picked: null, results: [], weak: !!(ids && ids.length) };
  renderJlpt();
  const lens = document.getElementById('jlGrammarLens');
  if (lens) lens.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function mcqHtml() {
  const run = S.mcq;
  const q = run.questions[run.i];
  const total = run.questions.length;

  if (!q) {                                   // finished → the score card
    const sc = scoreMcq(run.results);
    const weak = weakPoints(sc.byPoint);
    const byId = new Map((grammarPoints() || []).map((p) => [p.id, p]));
    const trail = (state.jlptStore || {}).mcq || {};
    const label = (id) => escapeHtml((byId.get(id) || {}).label || id);
    // Each missed pattern carries its LIFETIME record, so a one-off slip reads differently from a
    // pattern you've now missed four times running.
    const weakList = weak.length
      ? `<div class="jl-covsub">missed this round: ${weak.map((id) => {
        const s = mcqStat(trail, id);
        return `<span class="jp">${label(id)}</span>${s ? `<i class="jl-mcq-life">${s.right}/${s.seen}</i>` : ''}`;
      }).join(' · ')}</div>`
      : '<div class="jl-covsub">nothing missed — take another round, or drill the cloze cards.</div>';
    return `<div class="jl-mcq jl-mcq-done">
      <div class="jl-mcq-score"><b>${sc.right}<em>/${sc.total}</em></b><span>${sc.pct}%</span></div>
      ${weakList}
      <div class="jl-gp-ctas">
        <button class="chip primary jl-go" data-jl-act="mcq-start">Another round</button>
        ${mcqWeakIds().length ? '<button class="chip jl-go" data-jl-act="mcq-weak">Drill my 苦手</button>' : ''}
        <button class="chip jl-go" data-jl-act="mcq-close">Done</button>
      </div>
    </div>`;
  }

  const answered = run.picked != null;
  // `before`/`after` are interpolated RAW while every sibling here escapes — the stem carries
  // <ruby> furigana markup by design ("stem (clean ruby, one ＿＿＿ gap)", data/grammar-n3-mcq.js),
  // so escaping it would print the tags instead of the reading. The bank is a GENERATED, in-repo
  // artifact, never user input. Choices and `why` are plain text, hence escapeHtml on those.
  const [before, after] = splitStem(q.stem);
  const gap = answered
    ? `<span class="jl-mcq-fill ${run.picked === q.answer ? 'ok' : 'bad'}">${escapeHtml(q.choices[run.picked])}</span>`
    : '<span class="jl-mcq-gap"></span>';

  const choices = q.choices.map((c, i) => {
    let cls = '';
    if (answered) cls = i === q.answer ? ' ok' : (i === run.picked ? ' bad' : ' dim');
    return `<button class="jl-mcq-choice${cls}" data-jl-act="mcq-pick" data-pick="${i}"${answered ? ' disabled' : ''}>`
      + `<span class="jl-mcq-num">${i + 1}</span><span class="jp">${escapeHtml(c)}</span></button>`;
  }).join('');

  const right = run.results.filter((r) => r.correct).length;
  const correct = run.picked === q.answer;
  return `<div class="jl-mcq">
    <div class="jl-mcq-head">
      <span class="jl-mcq-pos">${run.i + 1} <i>/ ${total}</i></span>
      <span class="jl-mcq-track"><span class="jl-mcq-fillbar" style="width:${Math.round((100 * run.i) / total)}%"></span></span>
      <span class="jl-mcq-acc">${run.results.length ? `${right}/${run.results.length}` : '—'}</span>
      <button class="chip jl-go sm" data-jl-act="mcq-close">End</button>
    </div>
    <div class="jl-mcq-stem jp">${before}${gap}${after}</div>
    <div class="jl-mcq-choices">${choices}</div>
    ${answered ? `<div class="jl-mcq-why ${correct ? 'ok' : 'bad'}">
        <b>${correct ? '正解' : '不正解'}</b><span>${escapeHtml(q.why)}</span>
      </div>
      <div class="jl-gp-ctas"><button class="chip primary jl-go" data-jl-act="mcq-next">${run.i + 1 === total ? 'See score' : 'Next question'}</button></div>` : ''}
  </div>`;
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

function mockLogHtml(store) {
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
function captureMockField(el) {
  if (!S.mockForm || !el || !el.id) return false;
  const draft = S.mockDraft || (S.mockDraft = { scores: {} });
  if (el.id === 'jlMockDate') draft.date = el.value;
  else if (el.id === 'jlMockNotes') draft.notes = el.value;
  else if (el.id.startsWith('jlMock_')) (draft.scores || (draft.scores = {}))[el.id.slice(7)] = el.value;
  else return false;
  return true;
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
    const wkLoaded = !!state.wanikaniStore.token && WK.loaded;
    const wkIdx = wkLoaded ? wkVocabIndex(WK.subjects, WK.assignments) : null;
    const gap = jlptGap(map, level, deckWordSet(state.DATA), wkIdx);
    const targets = jlptTargets(state.jlptStore);
    const doneToday = weeklyAddPace(state.DATA, localDay(), level, { levelOf: cardJlptLevel }).today;
    const n = Math.max(0, targets.wordsPerDay - doneToday) || targets.wordsPerDay;
    const added = addJlptWords(selectGapBatch(words, gap.uncovered, wkIdx, (wkLoaded && WK.user && WK.user.level) || 0, n), level);
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
  // ---- 文法形式判断 MCQ drill ----
  // The quiz is assembled ONCE per run; Math.random is fine here (the feature layer, not core) and
  // buildMcqQuiz shuffles both the question order and each question's choices — the bank always
  // stores the answer at a fixed index, so an unshuffled drill would teach position, not grammar.
  'mcq-start': () => startMcq(),
  // Same drill, drawn only from the points the trail says you keep missing.
  'mcq-weak': () => startMcq(mcqWeakIds()),
  'mcq-pick': (el) => {
    const run = S.mcq;
    if (!run || run.picked != null) return;                 // guard a double-tap
    const q = run.questions[run.i];
    run.picked = Number(el.dataset.pick);
    const correct = run.picked === q.answer;
    run.results.push({ pointId: q.pointId, correct });
    // Write THROUGH to the durable trail on every answer, not at run end — ending a drill early
    // (or closing the tab mid-run) must not throw away the questions you actually answered.
    const store = state.jlptStore;
    if (store) {
      store.mcq = applyMcqResult(store.mcq, q.pointId, correct, localDay());
      saveJlpt();
    }
    renderJlpt();
  },
  'mcq-next': () => {
    const run = S.mcq;
    if (!run || run.picked == null) return;                 // can't skip an unanswered question
    run.i++; run.picked = null;
    renderJlpt();
  },
  'mcq-close': () => { closeMcq(); renderJlpt(); },
  // ---- mock-test log ----
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
