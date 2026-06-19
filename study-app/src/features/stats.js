// STATS panel — the DATA + DOM glue for #panel-stats. The PURE chart/stat builders (the
// SVG line chart, the SRS box-histogram HTML, the accuracy + week-over-week aggregation)
// live in core/charts.js (DOM-free + unit-tested); this module reads state, calls them,
// and owns the DOM writes (innerHTML / badges / the line draw-in animation) + the
// interactions (show-all toggle, leech-review pills, hard reset). No chart library.
import { state } from '../state.js';
import { localDay } from '../config.js';
import { rollingAcc, leeches, dueCards, studyStreak, colorClass, classKanji, cardStamp,
  accuracyMix, weekOverWeekDelta, boxCounts, dailyAccuracySvg, pipelineHtml } from '../core/index.js';
import { save } from '../persistence/store.js';
import { cfg, repaintDeck, updateDeckCount } from './deck.js';
import { startSession } from './flashcard.js';
import { renderBrowse } from './browse.js';

// Mount the daily-accuracy line chart into `el`: empty-state, else the pure
// dailyAccuracySvg(pts) (core/charts.js) + the line draw-in animation over its true length
// (so any series length draws smoothly) + the "today" badge. pts = [{y, label}].
function drawDaily(el, pts) {
  el.innerHTML = '';
  if (!pts.length) { el.innerHTML = '<div class="empty" style="padding:24px">No data yet — finish a flashcard session.</div>'; setBadge('dailyToday', '—'); return; }
  el.innerHTML = dailyAccuracySvg(pts);
  const line = el.querySelector('#dailyLine');
  if (line && line.getTotalLength) { const L = Math.ceil(line.getTotalLength()); line.style.strokeDasharray = L; line.style.strokeDashoffset = L; line.style.animation = 'drawLine 1.3s cubic-bezier(.4,.6,.2,1) .3s forwards'; }
  setBadge('dailyToday', pts[pts.length - 1].y + '%');
}
// Set a panel badge's text if present (badges live in the markup; renderStats fills the counts).
const setBadge = (id, txt) => { const b = document.getElementById(id); if (b) b.textContent = txt; };

// Per-card accuracy bars (mock): a 2-column grid of word + track + %, colour-coded on the
// accuracy ramp (poor <55 / mid 55-75 / good >75), worst-first, capped to CARDBARS_CAP with a
// show-all toggle (uncapped, a fully-drilled deck is a ~2600px wall of mostly-mastered bars).
const CARDBARS_CAP = 20;
let cardBarsExpanded = false;
function renderCardBars() {
  const drilled = state.DATA.filter(v => { const c = state.store.cards[v.rank]; return c && c.attempts.length; })
    .map(v => ({ jp: v.jp, val: Math.round(rollingAcc(v.rank) * 100) }))
    .sort((a, b) => a.val - b.val);
  const el = document.getElementById('cardBars');
  if (!drilled.length) { el.innerHTML = '<div class="empty" style="padding:24px">No attempts logged yet.</div>'; setBadge('cardbarsBadge', '—'); return; }
  const shown = cardBarsExpanded ? drilled : drilled.slice(0, CARDBARS_CAP);
  const tone = v => v < 55 ? 'poor' : (v <= 75 ? 'mid' : 'good');
  const cap = `showing ${cardBarsExpanded ? `all ${drilled.length}` : `the worst ${Math.min(CARDBARS_CAP, drilled.length)} of ${drilled.length}`} studied`;
  const toggle = drilled.length > CARDBARS_CAP ? ` · <button class="cb-toggle" type="button">${cardBarsExpanded ? 'show worst ' + CARDBARS_CAP : 'show all'}</button>` : '';
  el.innerHTML = '<div class="cardbars">' + shown.map((c, i) => {
    const t = tone(c.val);
    return `<div class="cbar"><span class="cb-word jp">${c.jp}</span><span class="cb-track"><span class="cb-fill ${t}" style="width:${c.val}%;animation-delay:${(0.4 + i * 0.02).toFixed(2)}s"></span></span><span class="cb-pct ${t}">${c.val}%</span></div>`;
  }).join('') + '</div>'
    + `<div class="cardbars-cap"><span class="legend"><i><b style="background:var(--acc-poor)"></b>under 55%</i><i><b style="background:var(--acc-mid)"></b>55–75%</i><i><b style="background:var(--acc-good)"></b>over 75%</i></span><span>${cap}${toggle}</span></div>`;
  setBadge('cardbarsBadge', (cardBarsExpanded ? 'all ' + drilled.length : 'worst ' + Math.min(CARDBARS_CAP, drilled.length)) + ' shown');
  const tg = el.querySelector('.cb-toggle');
  if (tg) tg.addEventListener('click', () => { cardBarsExpanded = !cardBarsExpanded; renderCardBars(); });
}
// Rebuild the entire Stats panel from state.store. Called on tab activation and after
// import/reset. Each block maps 1:1 to a container in the markup.
export function renderStats() {
  // Summary boxes. "Cards drilled" = distinct cards with ≥1 attempt (the card ledger).
  let studied = 0;
  state.DATA.forEach(v => { const c = state.store.cards[v.rank]; if (c && c.attempts.length) studied++; });
  // Review counts + overall accuracy come from the SESSION ledger, not the per-card attempt
  // sum (see accuracyMix in core/charts.js for why — Total/SRS/Free reconcile; legacy
  // sessions with no `kind` count as SRS).
  const { tot, right, overall } = accuracyMix(state.store.sessions);
  const total = state.DATA.length, due = dueCards().length, leechN = leeches().length;
  const streak = studyStreak(state.store.daily, localDay()), sessN = state.store.sessions.length;
  // Editorial lead (mock voice) — a one-line read on the deck's state.
  const sub = document.getElementById('statsSub');
  if (sub) sub.innerHTML = tot
    ? `${streak ? `<b>${streak}</b> day${streak === 1 ? '' : 's'} in a row, ` : ''}<b>${studied}</b> of <b>${total}</b> cards in rotation.${leechN ? ` The pipeline is filling — <b>${leechN}</b> stubborn leech${leechN === 1 ? '' : 'es'} ${leechN === 1 ? 'is' : 'are'} still holding you up.` : ` <b>${overall}%</b> overall accuracy across <b>${sessN}</b> session${sessN === 1 ? '' : 's'}.`}`
    : 'No reviews logged yet — finish a flashcard session to start your record.';
  // Metric cards — the mock's hero grid: 3 HERO (accuracy/studied/reviews) over 3 QUIET
  // (due/streak/leeches). Label icons are inline (match the mock); the accuracy hero
  // carries a REAL week-over-week trend pill from the session ledger (it falls back to a
  // plain sublabel when there isn't a full prior week to compare against).
  const mIcon = (p, sw = 1.7) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const I = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    hist: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 4v4h4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    flame: '<path d="M12 3c2 3 4 4.5 4 8a4 4 0 0 1-8 0c0-1.5.6-2.6 1.4-3.6C9.8 8.6 11 7 12 3z"/>',
    alert: '<path d="M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    trend: '<path d="M3 17 9 11l4 4 8-8M21 7h-5M21 7v5"/>'
  };
  // Week-over-week accuracy delta (points), from the session ledger; null if no prior week.
  const dPts = weekOverWeekDelta(state.store.sessions, Date.now());
  const accExtra = dPts == null
    ? `<div class="m-sub">of <b>${tot.toLocaleString()}</b> review${tot === 1 ? '' : 's'}</div>`
    : `<span class="trend${dPts < 0 ? ' down' : ''}">${mIcon(I.trend, 2.2)}${dPts < 0 ? '−' : '+'}${Math.abs(dPts)} pts vs last week</span>`;
  const pctStudied = total ? Math.round(100 * studied / total) : 0;
  const sg = document.getElementById('statgrid');
  sg.innerHTML = `
    <div class="metric is-hero accent-good"><div class="m-label">${mIcon(I.check, 1.8)}Overall accuracy</div><div class="m-val">${overall}<span class="unit">%</span></div>${accExtra}</div>
    <div class="metric is-hero"><div class="m-label">${mIcon(I.book)}Cards studied</div><div class="m-val">${studied}<span class="frac">&thinsp;/&thinsp;${total}</span></div><div class="m-sub"><b>${pctStudied}%</b> of the deck in rotation</div></div>
    <div class="metric is-hero"><div class="m-label">${mIcon(I.hist)}Reviews logged</div><div class="m-val">${tot.toLocaleString()}</div><div class="m-sub">across <b>${sessN}</b> session${sessN === 1 ? '' : 's'}</div></div>
    <div class="metric quiet due"><div class="m-label">${mIcon(I.clock)}Due today</div><div class="m-val">${due}</div><div class="m-sub">${due ? 'ready to review now' : 'all caught up'}</div></div>
    <div class="metric quiet streak"><div class="m-label">${mIcon(I.flame)}Current streak</div><div class="m-val">${streak}<span class="unit">day${streak === 1 ? '' : 's'}</span></div><div class="m-sub">${streak ? 'keep it lit' : 'study today to start'}</div></div>
    <div class="metric quiet leech accent-leech"><div class="m-label">${mIcon(I.alert, 1.8)}Active leeches</div><div class="m-val">${leechN}</div><div class="m-sub">${leechN ? 'chronically missed' : 'all clear'}</div></div>`;
  // Daily accuracy line: one point per day in state.store.daily (label = MM-DD). The panel
  // badge shows the mean daily accuracy. (The mock has no per-session chart — the old
  // #chartSession was dropped; daily accuracy is the single retention line.)
  const days = Object.keys(state.store.daily).sort();
  const dvals = days.map(d => Math.round(100 * state.store.daily[d].right / state.store.daily[d].tot));
  setBadge('dailyBadge', dvals.length ? 'avg ' + Math.round(dvals.reduce((s, x) => s + x, 0) / dvals.length) + '%' : 'no data yet');
  drawDaily(document.getElementById('chartDaily'), days.map((d, i) => ({ y: dvals[i], label: d.slice(5) })));
  // Leech list (mock): rich plum-spined rows, worst-first, each with an accuracy bar, the
  // attempt count, and a per-row Review pill that drills that one card (wired in initStatsUI).
  const lz = leeches().slice().sort((a, b) => rollingAcc(a.rank) - rollingAcc(b.rank));
  const ll = document.getElementById('leechList');
  setBadge('leechBadge', lz.length + (lz.length === 1 ? ' card' : ' cards'));
  if (!lz.length) { ll.innerHTML = '<div class="empty" style="padding:18px">No leeches detected. A leech is any card under 60% over its last 4+ attempts.</div>'; }
  else {
    ll.innerHTML = '<div class="leech-list">' + lz.map((v, i) => {
      const pct = Math.round(rollingAcc(v.rank) * 100);
      const att = (state.store.cards[v.rank] || { attempts: [] }).attempts.length;
      return `<div class="leech-row">
        <span class="line-bullet ${colorClass(v)}" title="${cardStamp(v).label}">${classKanji(v)}</span>
        <div class="leech-word"><span class="jp">${v.jp}</span><span class="read">${v.read}</span></div>
        <div class="leech-mid"><div class="mean">${v.mean}</div><div class="accwrap"><span class="accbar"><i style="width:${pct}%;animation-delay:${(0.45 + i * 0.05).toFixed(2)}s"></i></span><span class="accpct">${pct}%</span><span class="attempts">· ${att} attempt${att === 1 ? '' : 's'}</span></div></div>
        <div class="leech-act"><button class="pill review" data-rank="${v.rank}" title="Review ${v.jp} now">${mIcon(I.hist, 2)}Review</button></div>
      </div>`;
    }).join('') + '</div>';
  }
  // Per-card accuracy bars (worst-first, capped + show-all toggle).
  renderCardBars();
  // SRS memory pipeline: six VERTICAL bars on the stone→jade Leitner ramp (the height/
  // gradient geometry is pipelineHtml in core/charts.js); the badge is the deck size.
  const boxes = boxCounts(state.DATA, state.store.cards);
  setBadge('pipeBadge', total + (total === 1 ? ' card' : ' cards'));
  document.getElementById('boxDist').innerHTML = pipelineHtml(boxes);
}

// Drill a single card now: scope the flashcard deck to one rank in FREE study (so the card is
// reviewable regardless of its due date) and start. Mirrors the studyLeeches jump; used by the
// per-row leech "Review" pills.
function reviewSingle(rank) {
  document.querySelector('.tab[data-tab="study"]').click();
  cfg.cat = []; cfg.type = []; cfg.trans = []; cfg.topic = []; cfg.status = []; cfg.source = []; cfg.jlpt = ['all']; cfg.kind = 'free'; cfg.rmin = rank; cfg.rmax = rank;
  repaintDeck();
  document.querySelectorAll('.chip.jlpt').forEach(x => x.classList.toggle('active', x.dataset.jlpt === 'all'));
  const rminEl = document.getElementById('rmin'), rmaxEl = document.getElementById('rmax');
  if (rminEl) rminEl.value = rank; if (rmaxEl) rmaxEl.value = rank;
  updateDeckCount();
  startSession();
}

// Wire the Stats-panel actions (study-leeches jump + per-row review + hard reset).
export function initStatsUI() {
  // "Study leeches now": jump to the flashcard tab with a leech-only deck. Like
  // startDueSession() it overrides the picker and syncs the chip UI to match.
  document.getElementById('studyLeeches').addEventListener('click', () => {
    document.querySelector('.tab[data-tab="study"]').click();
    cfg.type = []; cfg.trans = []; cfg.topic = []; cfg.status = ['leech']; cfg.source = []; cfg.jlpt = ['all']; cfg.rmin = 1; cfg.rmax = 100;
    repaintDeck();
    document.querySelectorAll('.chip.jlpt').forEach(x => x.classList.toggle('active', x.dataset.jlpt === 'all'));
    document.getElementById('rmin').value = 1; document.getElementById('rmax').value = 100;
    updateDeckCount();
    startSession();
  });
  // Per-row leech "Review" pills (delegated — the list re-renders on every renderStats).
  document.getElementById('leechList').addEventListener('click', (e) => {
    const btn = e.target.closest('.pill.review'); if (!btn) return;
    reviewSingle(+btn.dataset.rank);
  });
  // Hard reset: wipe ALL progress (after a confirm) and re-render derived views.
  document.getElementById('resetBtn').addEventListener('click', () => {
    if (confirm("Erase all stats, session history, and leech data? This can't be undone.")) {
      state.store = { cards: {}, sessions: [], daily: {} }; save(); renderStats(); renderBrowse(); updateDeckCount();
    }
  });
}
