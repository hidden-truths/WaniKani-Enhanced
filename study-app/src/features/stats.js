// STATS + CHARTS — all hand-rolled, no chart library (keeps zero-dependency). lineChart()
// builds an SVG string for a 0–100% series; barChart() builds HTML rows. Both are pure
// render helpers fed by renderStats(). A few SVG colors are literal hex (gridlines/axis
// labels) because they're intentionally the light-theme hairline tone.
import { state } from '../state.js';
import { localDay } from '../config.js';
import { rollingAcc, isLeech, leeches, dueCards, studyStreak, BOX_COLORS } from '../core/index.js';
import { save } from '../persistence/store.js';
import { cfg, repaintDeck, updateDeckCount } from './deck.js';
import { startSession } from './flashcard.js';
import { renderBrowse } from './browse.js';

// 0–100% line chart. pts = [{y, label}]. Single-point series is centered. opt: {color, aria}.
function lineChart(el, pts, opt = {}) {
  const W = 720, H = 212, pad = { l: 38, r: 50, t: 18, b: 30 };
  el.innerHTML = '';
  if (pts.length === 0) { el.innerHTML = '<div class="empty" style="padding:24px">No data yet — finish a flashcard session.</div>'; return; }
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const n = pts.length, color = opt.color || 'var(--godan)';
  const xOf = i => pad.l + (n === 1 ? iw / 2 : iw * i / (n - 1));   // x position by index
  const yOf = y => pad.t + ih - (y / 100) * ih;              // y position by percentage
  let g = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${opt.aria || 'Accuracy over time, percent correct'}">`;
  // gridlines + y-axis labels at 0/25/50/75/100 (theme-aware tones)
  [0, 25, 50, 75, 100].forEach(gy => { const y = yOf(gy); g += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="var(--line)" stroke-width="1"/><text x="${pad.l - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="var(--muted)" font-family="monospace">${gy}</text>`; });
  // y-axis caption
  g += `<text x="${pad.l - 6}" y="${pad.t - 6}" text-anchor="end" font-size="8" fill="var(--muted)" font-family="monospace">% correct</text>`;
  // dashed average reference line + right-margin label
  const avg = Math.round(pts.reduce((s, p) => s + p.y, 0) / n), ay = yOf(avg);
  g += `<line x1="${pad.l}" y1="${ay}" x2="${W - pad.r}" y2="${ay}" stroke="var(--ichidan)" stroke-width="1" stroke-dasharray="3 3" opacity="0.65"/><text x="${W - pad.r + 4}" y="${ay + 3}" font-size="8.5" fill="var(--ichidan)" font-family="monospace">avg ${avg}%</text>`;
  // area fill under the line + the line itself
  const dpath = pts.map((p, i) => `${i ? 'L' : 'M'}${xOf(i).toFixed(1)},${yOf(p.y).toFixed(1)}`).join(' ');
  g += `<path d="${dpath} L${xOf(n - 1).toFixed(1)},${yOf(0).toFixed(1)} L${xOf(0).toFixed(1)},${yOf(0).toFixed(1)} Z" fill="${color}" opacity="0.08"/>`;
  g += `<path d="${dpath}" fill="none" stroke="${color}" stroke-width="2"/>`;
  // points (with hover readout) + value labels (few points) + thinned x-axis labels
  pts.forEach((p, i) => { const x = xOf(i), y = yOf(p.y);
    g += `<circle class="pt" cx="${x}" cy="${y}" r="3.2" fill="${color}"><title>${p.label}: ${p.y}%</title></circle>`;
    if (n <= 12) g += `<text x="${x}" y="${y - 7}" text-anchor="middle" font-size="8.5" fill="var(--muted)" font-family="monospace">${p.y}</text>`;
    if (n <= 12 || i % Math.ceil(n / 8) === 0) g += `<text x="${x}" y="${H - 9}" text-anchor="middle" font-size="8" fill="var(--muted)" font-family="monospace">${p.label}</text>`; });
  g += '</svg>'; el.innerHTML = g;
}
// Horizontal bar list. items = [{label, val(0–100), color}].
function barChart(el, items) {
  el.innerHTML = '';
  if (!items.length) { el.innerHTML = '<div class="empty" style="padding:24px">No attempts logged yet.</div>'; return; }
  let h = '';
  items.forEach(it => {
    h += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
      <div style="width:120px;font-family:var(--jp-font);font-size:14px">${it.label}</div>
      <div style="flex:1;background:var(--paper-2);border-radius:2px;height:16px;position:relative">
        <div style="width:${it.val}%;background:${it.color};height:100%;border-radius:2px"></div></div>
      <div style="width:42px;text-align:right;font-family:monospace;font-size:11px;color:var(--muted)">${it.val}%</div></div>`;
  });
  el.innerHTML = h;
}
// Per-card accuracy bars, capped to the worst CARDBARS_CAP by default (sorted worst→best so
// the actionable cards lead) with a show-all toggle. Uncapped, a fully-drilled deck is a
// ~2600px wall of mostly-mastered bars.
const CARDBARS_CAP = 20;
let cardBarsExpanded = false;
function renderCardBars() {
  const drilled = state.DATA.filter(v => { const c = state.store.cards[v.rank]; return c && c.attempts.length; })
    .map(v => ({ label: v.jp, val: Math.round(rollingAcc(v.rank) * 100), color: isLeech(v.rank) ? 'var(--leech)' : (rollingAcc(v.rank) >= 0.8 ? 'var(--good)' : 'var(--godan)') }))
    .sort((a, b) => a.val - b.val);
  const el = document.getElementById('cardBars');
  barChart(el, cardBarsExpanded ? drilled : drilled.slice(0, CARDBARS_CAP));
  if (drilled.length > CARDBARS_CAP) {
    const btn = document.createElement('button');
    btn.className = 'chip'; btn.style.marginTop = '12px';
    btn.textContent = cardBarsExpanded ? `Show worst ${CARDBARS_CAP} only` : `Show all ${drilled.length} cards`;
    btn.addEventListener('click', () => { cardBarsExpanded = !cardBarsExpanded; renderCardBars(); });
    el.appendChild(btn);
  }
}
// Rebuild the entire Stats panel from state.store. Called on tab activation and after
// import/reset. Each block maps 1:1 to a container in the markup.
export function renderStats() {
  // Summary boxes. "Cards drilled" = distinct cards with ≥1 attempt (the card ledger).
  let studied = 0;
  state.DATA.forEach(v => { const c = state.store.cards[v.rank]; if (c && c.attempts.length) studied++; });
  // Review counts + overall accuracy come from the SESSION ledger, NOT the per-card attempt sum,
  // so the Total / SRS / Free tiles reconcile (Total = SRS + Free) and accuracy shares their
  // denominator. `kind` lives only on sessions, so that's the only ledger that can be split; for
  // normal use (every grade lands in exactly one logged session) the session sum equals the
  // per-card attempt sum anyway. Legacy sessions with no `kind` count as SRS (the old behavior).
  const mix = { srs: { rev: 0, right: 0 }, free: { rev: 0, right: 0 } };
  state.store.sessions.forEach(s => { const m = mix[s.kind === 'free' ? 'free' : 'srs']; m.rev += s.tot; m.right += s.right; });
  const tot = mix.srs.rev + mix.free.rev, right = mix.srs.right + mix.free.right;
  const overall = tot ? Math.round(100 * right / tot) : 0;
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
  const WK = 7 * 864e5, nowT = Date.now();
  const win = { tw: { r: 0, t: 0 }, lw: { r: 0, t: 0 } };
  state.store.sessions.forEach(s => { if (!s.t) return; if (s.t >= nowT - WK) { win.tw.r += s.right; win.tw.t += s.tot; } else if (s.t >= nowT - 2 * WK) { win.lw.r += s.right; win.lw.t += s.tot; } });
  const dPts = (win.tw.t && win.lw.t) ? Math.round(100 * win.tw.r / win.tw.t - 100 * win.lw.r / win.lw.t) : null;
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
  // Daily accuracy line: one point per day in state.store.daily (label = MM-DD).
  const days = Object.keys(state.store.daily).sort();
  lineChart(document.getElementById('chartDaily'), days.map(d => ({ y: Math.round(100 * state.store.daily[d].right / state.store.daily[d].tot), label: d.slice(5) })), { aria: 'Daily accuracy, percent correct per day' });
  // Per-session line: last 20 sessions, labeled by their absolute session number.
  const sess = state.store.sessions.slice(-20);
  lineChart(document.getElementById('chartSession'), sess.map((s, i) => ({ y: Math.round(100 * s.right / s.tot), label: '#' + (state.store.sessions.length - sess.length + i + 1) })), { color: 'var(--ichidan)', aria: 'Per-session accuracy, percent correct per session' });
  // Leech list: the cards isLeech() currently flags, with their rolling accuracy.
  const lz = leeches(); const ll = document.getElementById('leechList');
  if (!lz.length) { ll.innerHTML = '<div class="empty" style="padding:18px">No leeches detected. A leech is any card under 60% over its last 4+ attempts.</div>'; }
  else { ll.innerHTML = lz.map(v => `<div class="leech-row">
    <span class="lr-jp jp">${v.jp}</span>
    <span class="lr-meta">${v.read} · ${v.mean}</span>
    <span class="lr-acc"><svg class="ic" aria-hidden="true"><use href="#i-alert"/></svg>${Math.round(rollingAcc(v.rank) * 100)}%</span></div>`).join(''); }
  // Per-card accuracy bars (worst-first, capped + show-all toggle).
  renderCardBars();
  // SRS memory pipeline: count cards in each Leitner box (0=New … 5).
  const boxes = [0, 0, 0, 0, 0, 0]; // index = box 0..5
  state.DATA.forEach(v => { const c = state.store.cards[v.rank]; const b = c && c.box ? c.box : 0; boxes[b]++; });
  const boxLabels = ['New', 'Box 1', 'Box 2', 'Box 3', 'Box 4', 'Box 5'];
  const boxColors = BOX_COLORS;   // New→stone, then red→amber→gold→olive→green as cards mature
  const bd = document.getElementById('boxDist');
  bd.innerHTML = boxes.map((n, i) => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
    <div style="width:54px;font-family:monospace;font-size:11px;color:var(--muted)">${boxLabels[i]}</div>
    <div style="flex:1;background:var(--paper-2);border-radius:2px;height:16px;position:relative">
      <div class="barx" style="width:${total ? Math.round(100 * n / total) : 0}%;background:${boxColors[i]};height:100%;border-radius:2px;min-width:${n ? '3px' : '0'}"></div></div>
    <div style="width:32px;text-align:right;font-family:monospace;font-size:11px;color:var(--muted)">${n}</div></div>`).join('');
}

// Wire the Stats-panel actions (study-leeches jump + hard reset).
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
  // Hard reset: wipe ALL progress (after a confirm) and re-render derived views.
  document.getElementById('resetBtn').addEventListener('click', () => {
    if (confirm("Erase all stats, session history, and leech data? This can't be undone.")) {
      state.store = { cards: {}, sessions: [], daily: {} }; save(); renderStats(); renderBrowse(); updateDeckCount();
    }
  });
}
