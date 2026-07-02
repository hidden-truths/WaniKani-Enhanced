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
  wkForecast, JLPT_LEVEL_ORDER,
} from '../../core/index.js';
import { jlptMap } from './data.js';
import { saveJlpt } from './store.js';
import { startDueSession, studyLeechCards } from '../deck.js';
import { openBrowseGrammar } from '../browse.js';
import { S as WK } from '../wanikani/state.js';
import { leechList } from '../wanikani/leeches.js';

const goTab = (tab) => { const t = document.querySelector(`.tab[data-tab="${tab}"]`); if (t) t.click(); };

/* ---- live signals ------------------------------------------------------------ */

// One read over the app's stores → everything the checklist + readiness cards show.
// WK numbers are null when no token / dataset not yet in memory (ensureWkData is kicked
// on tab open; onWkData re-renders when it lands).
function collectSignals() {
  const today = localDay();
  const daily = state.store.daily || {};
  let week = 0;
  for (let i = 0; i < 7; i++) { const d = daily[shiftDay(today, -i)]; if (d) week += d.tot || 0; }
  const wkConnected = !!state.wanikaniStore.token;
  const wkLoaded = wkConnected && WK.loaded;
  return {
    today,
    due: dueCards().length,
    reviewedToday: (daily[today] && daily[today].tot) || 0,
    weekReviews: week,
    streak: studyStreak(daily, today),
    appLeeches: leeches().length,
    speakStreak: practiceStreak(state.selftalkStore.practice, today),
    spokeToday: (state.selftalkStore.practice || {}).lastDay === today,
    lastLesson: state.minnaStore.lastLesson,
    wkConnected, wkLoaded,
    wkReviewsNow: wkLoaded ? wkForecast([...WK.assignments.values()], Date.now()).availableNow : null,
    wkLessons: wkLoaded && WK.summary ? WK.summary.lessons : null,
    wkLeeches: wkLoaded ? leechList().length : null,
    wkLevel: wkLoaded && WK.user ? WK.user.level : null,
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
  t.push({
    id: 'grammar', jp: '法', title: 'One grammar point', auto: false,
    done: !!dayRec.grammar, checkable: true,
    sub: 'pick a point in Browse → Grammar and read its example sentences aloud',
    act: 'go-grammar', actLabel: 'Grammar',
  });
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
    + sectionsHtml(store, sig);
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
      <div class="jl-hero-pills">
        ${sig.streak ? `<span class="pill"><span class="dot"></span><b>Day ${sig.streak}</b>&nbsp;review streak</span>` : ''}
        ${sig.speakStreak ? `<span class="pill"><span class="dot speak"></span><b>Day ${sig.speakStreak}</b>&nbsp;speaking</span>` : ''}
        ${sig.wkLevel ? `<span class="pill"><span class="dot wk"></span>WK&nbsp;<b>level ${sig.wkLevel}</b></span>` : ''}
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
        : `<div class="jl-covsub">${sig.wkConnected ? 'loading WaniKani data…' : `<button class="jl-link" data-jl-act="go-wanikani">Connect WaniKani</button> to see how much ${level} vocabulary your reviews already cover.`}</div>`);
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

function sectionsHtml(store, sig) {
  const cards = [
    {
      jp: '語彙', en: 'Vocabulary & Kanji', icon: 'i-cards',
      copy: 'Daily SRS both sides: WaniKani for kanji recognition, this deck for recall. Leeches are the highest-value fixes — same-kanji families live on the 鰐蟹 tab.',
      links: [
        { act: 'go-due', label: 'Review due cards' },
        { act: 'go-wanikani', label: '鰐蟹 leeches' },
      ],
    },
    {
      jp: '文法', en: 'Grammar', icon: 'i-book',
      copy: 'One point a day, seen in real sentences. The Browse grammar facet filters your cards to sentences that use a point; 教科書 lessons introduce new ones in order.',
      links: [
        { act: 'go-grammar', label: 'Browse by grammar' },
        { act: 'go-minna', label: '教科書 lessons' },
      ],
    },
    {
      jp: '読解', en: 'Reading', icon: 'i-eye',
      copy: 'Read Japanese you half-know: lesson passages and song lyrics with furigana off, tap only the words that stop you. Volume matters more than difficulty.',
      links: [
        { act: 'go-minna', label: 'Lesson reading' },
        { act: 'go-songs', label: '歌 Read mode' },
      ],
    },
    {
      jp: '聴解', en: 'Listening', icon: 'i-headphones',
      copy: 'Dictation is the sharpest listening drill: 歌 Listen blanks a line, you type what you hear. Shadowing the same line then trains the mouth on what the ear caught.',
      links: [
        { act: 'go-songs', label: '歌 Listen & Shadow' },
        { act: 'go-selftalk', label: '独り言 speaking' },
      ],
    },
  ];
  const grid = cards.map((c) => `<div class="jl-section">
      <div class="jl-section-head"><span class="jl-section-jp jp-min">${c.jp}</span><b>${c.en}</b><svg class="ic" aria-hidden="true"><use href="#${c.icon}"/></svg></div>
      <p>${c.copy}</p>
      <div class="jl-section-links">${c.links.map((l) => `<button class="chip jl-go" data-jl-act="${l.act}">${l.label}</button>`).join('')}</div>
    </div>`).join('');
  return `<section class="jl-card jl-sections-card">
    <div class="jl-card-head"><div><h2 class="title">The four papers</h2>
      <div class="sub">every ${store.level} section, mapped to the surface that trains it${store.level !== 'N3' ? ' · guidance copy is tuned for N3 for now' : ''}</div></div></div>
    <div class="jl-sections">${grid}</div>
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
};

export function wireJlpt() {
  const panel = document.getElementById('panel-jlpt');
  if (!panel || panel.dataset.jlWired) return;
  panel.dataset.jlWired = '1';
  panel.addEventListener('click', (e) => {
    const el = e.target.closest('[data-jl-act]');
    if (!el || el.disabled) return;
    const fn = ACTIONS[el.dataset.jlAct];
    if (fn) fn(el, e);
  });
  // The exam-date input commits on change (native date picker); re-render reflows the countdown.
  panel.addEventListener('change', (e) => {
    if (e.target.id !== 'jlptDate') return;
    const v = e.target.value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { state.jlptStore.examDate = v; saveJlpt(); renderJlpt(); }
  });
}
