// 鰐蟹 dashboard (概観 Overview) — the landing view over the synced dataset: hero
// metric cards, the SRS stage pipeline, the review forecast, level pace, lifetime
// accuracy, and a worst-leeches preview. Charts are hand-rolled SVG strings (app
// dead-end: no chart library); all derivation is core/wanikani.js.
import { S } from './state.js';
import { state } from '../../state.js';
import {
  bandCounts, wkForecast, levelProgress, levelPace, accuracySummary, WK_BANDS, timeUntil,
} from '../../core/index.js';
import { leechList, focusLeeches } from './leeches.js';
import { subjectRowHtml } from './bits.js';
import { wkDeckIndex, wkInDeck, wkDeckCount } from './activate.js';

export function dashboardHtml() {
  const now = Date.now();
  const assignments = [...S.assignments.values()];
  const stats = [...S.stats.values()];
  const bands = bandCounts(assignments);
  const fc = S.forecastMode === '7d'
    ? wkForecast(assignments, now, { slots: 7, stepMs: 864e5 })
    : wkForecast(assignments, now, { slots: 24, stepMs: 3600e3 });
  const level = (S.user && S.user.level) || 1;
  const lp = levelProgress([...S.subjects.values()], S.assignments, level);
  const pace = levelPace(S.progressions, now);
  const acc = accuracySummary(stats);
  const leeches = leechList();

  return metricsHtml(assignments, bands, fc, lp, acc, leeches, now)
    + stagesHtml(bands, level)
    + `<div class="wk-two">
         <section class="wk-card">${forecastHtml(fc, now)}</section>
         <section class="wk-card">${paceHtml(pace)}</section>
       </div>`
    + `<div class="wk-two">
         <section class="wk-card">${accuracyHtml(acc)}</section>
         <section class="wk-card">${leechPreviewHtml(leeches)}</section>
       </div>`;
}

/* ---- hero metrics ------------------------------------------------------------ */

// The actionable metrics link out: reviews/lessons open the matching wanikani.com
// session in a new tab (this app can't run WK reviews — the token is read-only), and
// the leech card jumps to the Leeches view. The rest stay plain readouts.
function metricsHtml(assignments, bands, fc, lp, acc, leeches, now) {
  // "next +N in Xh": the first non-empty upcoming slot of the current forecast window.
  const upcoming = nextBatch(assignments, now);
  const cards = [
    { big: fc.availableNow, label: 'reviews now', jp: '復習', cls: fc.availableNow ? 'hot' : '', sub: upcoming,
      href: fc.availableNow ? 'https://www.wanikani.com/subjects/review' : null },
    { big: (S.summary && S.summary.lessons) || 0, label: 'lessons ready', jp: '学習', sub: '',
      href: (S.summary && S.summary.lessons) ? 'https://www.wanikani.com/subjects/lesson' : null },
    { big: lp.pct + '%', label: 'level ' + ((S.user && S.user.level) || '—') + ' progress', jp: '段階', sub: `${lp.passed} of ${lp.needed} kanji passed` },
    { big: bands.apprentice, label: 'apprentice', jp: '見習', cls: 'appr', sub: 'the churn zone' },
    { big: bands.burned, label: 'burned', jp: '焼却', cls: 'burn', sub: 'done forever' },
    { big: leeches.length, label: 'leeches', jp: '苦手', cls: leeches.length ? 'leech' : '', sub: leechSub(leeches),
      view: leeches.length ? 'leeches' : null },
  ];
  return `<div class="wk-metrics">` + cards.map((c) => {
    const inner = `
      <span class="wk-metric-jp jp-min" aria-hidden="true">${c.jp}</span>
      <b class="wk-metric-big">${c.big}</b>
      <span class="wk-metric-label">${c.label}</span>
      ${c.sub ? `<span class="wk-metric-sub">${c.sub}</span>` : ''}`;
    if (c.href) return `<a class="wk-metric ${c.cls || ''} act" href="${c.href}" target="_blank" rel="noopener" title="Start on wanikani.com">${inner}<svg class="ic wk-metric-go" aria-hidden="true"><use href="#i-external"/></svg></a>`;
    if (c.view) return `<button class="wk-metric ${c.cls || ''} act" data-wk-act="view" data-view="${c.view}">${inner}<svg class="ic wk-metric-go" aria-hidden="true"><use href="#i-arrow-right"/></svg></button>`;
    return `<div class="wk-metric ${c.cls || ''}">${inner}</div>`;
  }).join('') + `</div>`;
}

// The leech metric's one-liner: lead with the exam-relevant slice when the JLPT lens
// has it (the countdown tab's target level), else the plain pointer to the view.
function leechSub(leeches) {
  if (!leeches.length) return 'none — clean slate';
  const focus = focusLeeches();
  if (focus.length) return `${focus.length} are ${(state.jlptStore || {}).level || 'N3'} — drill those first`;
  return 'see the Leeches view';
}

function nextBatch(assignments, now) {
  let at = null, n = 0;
  for (const a of assignments) {
    if (a.hidden || !a.availableAt || !a.startedAt || a.stage < 1 || a.stage > 8 || a.availableAt <= now) continue;
    if (at === null || a.availableAt < at) { at = a.availableAt; n = 1; }
    else if (a.availableAt === at) n++;
  }
  return at ? `+${n} ${timeUntil(at, now)}` : '';
}

/* ---- SRS stage pipeline -------------------------------------------------------- */

function stagesHtml(bands, level) {
  const max = Math.max(...WK_BANDS.map((b) => bands[b.key]), 1);
  const locked = lockedCount(level);
  const cols = WK_BANDS.map((b, i) => {
    const n = bands[b.key];
    const h = n === 0 ? 3 : Math.max(7, Math.round((n / max) * 88));
    return `<div class="wk-pcol"><div class="wk-ptrack"><div class="wk-pbar s-${b.css}${h < 58 ? ' count-above' : ''}" style="height:${h}%;animation-delay:${(0.25 + i * 0.06).toFixed(2)}s"><span class="count">${n}</span></div></div><div class="wk-plabel"><b><span class="jp">${b.jp}</span> ${b.label}</b></div></div>`;
  }).join('');
  return `<section class="wk-card wk-stagecard">
    <div class="wk-card-head"><div><h2 class="title">SRS pipeline</h2><div class="sub">where every started item sits · right = closer to burned</div></div>
    <span class="wk-card-badge">${bands.lesson} in lesson queue · ${locked} locked</span></div>
    <div class="wk-pipeline">${cols}</div>
  </section>`;
}

// Unlockable-but-untouched subjects at or below the current level with no assignment.
function lockedCount(level) {
  let n = 0;
  for (const s of S.subjects.values()) {
    if (!s.hidden && s.level <= level && !S.assignments.has(s.id)) n++;
  }
  return n;
}

/* ---- review forecast ------------------------------------------------------------ */

function forecastHtml(fc, now) {
  const daily = S.forecastMode === '7d';
  const W = 560, H = 190, padL = 8, padB = 26, padT = 26;
  const iw = W - padL * 2, ih = H - padT - padB;
  const n = fc.counts.length;
  const bw = iw / n;
  const max = Math.max(...fc.counts, 1);
  let bars = '';
  fc.counts.forEach((c, i) => {
    const h = c ? Math.max(3, (c / max) * ih) : 0;
    const x = padL + i * bw;
    if (c) bars += `<rect class="wk-fbar" x="${(x + bw * 0.14).toFixed(1)}" y="${(padT + ih - h).toFixed(1)}" width="${(bw * 0.72).toFixed(1)}" height="${h.toFixed(1)}" rx="3"><title>${label(i)}: ${c}</title></rect>`
      + (h > 16 || c >= max * 0.6 ? `<text class="wk-fnum" x="${(x + bw / 2).toFixed(1)}" y="${(padT + ih - h - 5).toFixed(1)}" text-anchor="middle">${c}</text>` : '');
    else bars += `<rect x="${(x + bw * 0.14).toFixed(1)}" y="${padT + ih - 2}" width="${(bw * 0.72).toFixed(1)}" height="2" rx="1" fill="var(--line)"/>`;
  });
  function label(i) {
    if (daily) { const d = new Date(now + (i + 0) * 864e5); return i === 0 ? 'today' : d.toLocaleDateString(undefined, { weekday: 'short' }); }
    return i === 0 ? 'now' : '+' + (i) + 'h';
  }
  let ticks = '';
  const every = daily ? 1 : 6;
  for (let i = 0; i < n; i += every) {
    ticks += `<text class="wk-ftick" x="${(padL + i * bw + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${label(i)}</text>`;
  }
  return `<div class="wk-card-head"><div><h2 class="title">Review forecast</h2><div class="sub">${fc.availableNow ? `<b class="wk-now-pill">${fc.availableNow} available now</b> · ` : ''}${fc.windowTotal} due in the next ${daily ? '7 days' : '24 hours'}</div></div>
    <span class="wk-fmodes">
      <button class="wk-minichip${!daily ? ' active' : ''}" data-wk-act="fmode" data-mode="24h">24h</button>
      <button class="wk-minichip${daily ? ' active' : ''}" data-wk-act="fmode" data-mode="7d">7 days</button>
    </span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Upcoming review forecast">${bars}${ticks}</svg>`;
}

/* ---- level pace ------------------------------------------------------------------ */

function paceHtml(pace) {
  const recent = pace.slice(-12);
  if (!recent.length) return `<div class="wk-card-head"><div><h2 class="title">Level pace</h2></div></div><div class="wk-empty">No level history yet.</div>`;
  const done = recent.filter((p) => !p.current).map((p) => p.days).sort((a, b) => a - b);
  const median = done.length ? done[Math.floor(done.length / 2)] : null;
  const W = 560, H = 190, padL = 8, padB = 26, padT = 20;
  const iw = W - padL * 2, ih = H - padT - padB;
  const bw = iw / recent.length;
  const max = Math.max(...recent.map((p) => p.days), median || 0, 1);
  let bars = '', ticks = '';
  recent.forEach((p, i) => {
    const h = Math.max(3, (p.days / max) * ih);
    const x = padL + i * bw;
    bars += `<rect class="wk-lbar${p.current ? ' current' : ''}" x="${(x + bw * 0.16).toFixed(1)}" y="${(padT + ih - h).toFixed(1)}" width="${(bw * 0.68).toFixed(1)}" height="${h.toFixed(1)}" rx="3"><title>Level ${p.level}: ${p.days.toFixed(1)} days${p.current ? ' (current)' : ''}</title></rect>`;
    ticks += `<text class="wk-ftick" x="${(x + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${p.level}</text>`;
  });
  const my = median != null ? padT + ih - (median / max) * ih : null;
  return `<div class="wk-card-head"><div><h2 class="title">Level pace</h2><div class="sub">days per level · last ${recent.length} levels${median != null ? ` · median ${median.toFixed(0)}d` : ''}</div></div></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Days spent per WaniKani level">
      ${my != null ? `<line x1="${padL}" y1="${my.toFixed(1)}" x2="${W - padL}" y2="${my.toFixed(1)}" stroke="var(--gold)" stroke-width="2" stroke-dasharray="7 5" opacity=".85"/>` : ''}
      ${bars}${ticks}</svg>`;
}

/* ---- accuracy --------------------------------------------------------------------- */

function accuracyHtml(acc) {
  const bar = (label, p, cls) => p == null ? '' : `
    <div class="wk-accrow${cls ? ' ' + cls : ''}"><span class="wk-accrow-label">${label}</span>
      <span class="wk-acctrack"><span class="wk-accfill" style="width:${p}%"></span></span>
      <b class="wk-accval">${p}%</b></div>`;
  // A brand-new WK account (or one that has done no reviews yet) has all-null stats — every bar()
  // returns '', so without this the card would be a bare title over an empty grid. Give it the same
  // "no data yet" empty state the pace/leech panels have.
  if (acc.total.overall == null) {
    return `<div class="wk-card-head"><div><h2 class="title">Lifetime accuracy</h2><div class="sub">every review answer you've ever given</div></div></div>
      <div class="wk-empty">No review history yet — come back after your first WaniKani reviews.</div>`;
  }
  return `<div class="wk-card-head"><div><h2 class="title">Lifetime accuracy</h2><div class="sub">every review answer you've ever given</div></div>
    <span class="wk-card-badge">${acc.total.overall}% overall</span></div>
    <div class="wk-accgrid">
      ${bar('Meaning', acc.total.meaning)}
      ${bar('Reading', acc.total.reading)}
      <div class="wk-accdiv"></div>
      ${bar('Radicals', acc.radical.overall, 't-radical')}
      ${bar('Kanji', acc.kanji.overall, 't-kanji')}
      ${bar('Vocabulary', acc.vocabulary.overall, 't-vocab')}
    </div>`;
}

/* ---- leech preview ------------------------------------------------------------------ */

function leechPreviewHtml(leeches) {
  const idx = wkDeckIndex();
  const rows = leeches.slice(0, 5).map((l) => subjectRowHtml(l.subject, { leech: true, score: true, inDeck: wkInDeck(l.subject, idx) })).join('');
  const deck = wkDeckCount();
  return `<div class="wk-card-head"><div><h2 class="title">Worst leeches</h2><div class="sub">the items eating your review sessions</div></div>
    ${leeches.length ? `<span class="wk-card-badge leech">${leeches.length}</span>` : ''}</div>
    ${leeches.length
      ? `<div class="wk-rows">${rows}</div>
         <div class="wk-btnrow">
           <button class="chip wk-morebtn" data-wk-act="view" data-view="leeches"><svg class="ic" aria-hidden="true"><use href="#i-arrow-right"/></svg>All leeches & confusion groups</button>
           ${deck.n ? `<button class="chip wk-studybtn" data-wk-act="studywk"><svg class="ic" aria-hidden="true"><use href="#i-cards"/></svg>Study 鰐蟹 deck${deck.due ? ` · ${deck.due} due` : ` · ${deck.n}`}</button>` : ''}
         </div>`
      : `<div class="wk-empty">Nothing qualifies as a leech right now. 素晴らしい。</div>`}`;
}
