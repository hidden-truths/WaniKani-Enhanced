// STATS + CHARTS — all hand-rolled, no chart library (keeps zero-dependency). lineChart()
// builds an SVG string for a 0–100% series; barChart() builds HTML rows. Both are pure
// render helpers fed by renderStats(). A few SVG colors are literal hex (gridlines/axis
// labels) because they're intentionally the light-theme hairline tone.
import { state } from '../state.js';
import { localDay } from '../config.js';
import { rollingAcc, leeches, dueCards, studyStreak } from '../core/index.js';
import { save } from '../persistence/store.js';
import { cfg, repaintDeck, updateDeckCount } from './deck.js';
import { startSession } from './flashcard.js';
import { renderBrowse } from './browse.js';

// Daily-accuracy line chart (mock): a zoomed y-axis so the line uses the canvas, an area
// gradient, a gold dashed average, the jade line with a CSS glow (theme-aware via --dl-line),
// dots, and sparse date ticks. All colors are CSS vars so the chart re-tints on a theme flip
// with NO re-render. pts = [{y, label}]; the foot's "today" readout is set from the last point.
function drawDaily(el, pts) {
  el.innerHTML = '';
  if (!pts.length) { el.innerHTML = '<div class="empty" style="padding:24px">No data yet — finish a flashcard session.</div>'; setBadge('dailyToday', '—'); return; }
  const W = 620, H = 270, pad = { l: 34, r: 16, t: 20, b: 30 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const vals = pts.map(p => p.y), n = vals.length;
  const avg = Math.round(vals.reduce((s, v) => s + v, 0) / n);
  // adaptive zoom: floor a touch below the min (rounded to 5, capped at 80) so even a high,
  // flat series uses the canvas instead of floating in the top third; ceil 100.
  const ymin = Math.min(80, Math.floor(Math.max(0, Math.min(...vals) - 8) / 5) * 5), ymax = 100;
  const xOf = i => pad.l + (n === 1 ? iw / 2 : iw * i / (n - 1));
  const yOf = v => pad.t + ih - (v - ymin) / (ymax - ymin) * ih;
  let g = `<svg class="dl-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily accuracy over ${n} day${n === 1 ? '' : 's'}, percent correct">`;
  g += `<defs><linearGradient id="dlArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--dl-line)" stop-opacity=".26"/><stop offset="100%" stop-color="var(--dl-line)" stop-opacity="0"/></linearGradient></defs>`;
  // faint gridlines + y labels at the multiples of 10 inside the zoomed range
  for (let v = Math.ceil(ymin / 10) * 10; v <= 100; v += 10) { const y = yOf(v); g += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="var(--line)" stroke-width="1" opacity=".55"/><text x="${pad.l - 8}" y="${y + 3.5}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="var(--mono)" opacity=".85">${v}</text>`; }
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${xOf(i).toFixed(1)},${yOf(p.y).toFixed(1)}`).join(' ');
  g += `<path d="${d} L${xOf(n - 1).toFixed(1)},${yOf(ymin)} L${xOf(0).toFixed(1)},${yOf(ymin)} Z" fill="url(#dlArea)"/>`;
  const ay = yOf(avg);
  g += `<line x1="${pad.l}" y1="${ay}" x2="${W - pad.r}" y2="${ay}" stroke="var(--gold)" stroke-width="2.5" stroke-dasharray="8 5" opacity=".9"/><text x="${W - pad.r}" y="${ay - 7}" text-anchor="end" font-size="11.5" fill="var(--gold)" font-family="var(--mono)" font-weight="500">avg ${avg}%</text>`;
  g += `<path id="dailyLine" d="${d}" fill="none" stroke="var(--dl-line)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`;
  pts.forEach((p, i) => { const cx = xOf(i), cy = yOf(p.y), last = i === n - 1; g += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${last ? 5 : 3.2}" fill="${last ? 'var(--dl-line)' : 'var(--paper)'}" stroke="var(--dl-line)" stroke-width="${last ? 0 : 2}"><title>${p.label}: ${p.y}%</title></circle>`; });
  // ~5 evenly-spaced date ticks; the last reads "today"
  const ticks = [...new Set([0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round(3 * (n - 1) / 4), n - 1])];
  ticks.forEach(i => { g += `<text x="${xOf(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="var(--muted)" font-family="var(--mono)">${i === n - 1 ? 'today' : pts[i].label}</text>`; });
  g += '</svg>'; el.innerHTML = g;
  // animate the line draw-in over its true length (so any series length draws smoothly)
  const line = el.querySelector('#dailyLine');
  if (line && line.getTotalLength) { const L = Math.ceil(line.getTotalLength()); line.style.strokeDasharray = L; line.style.strokeDashoffset = L; line.style.animation = 'drawLine 1.3s cubic-bezier(.4,.6,.2,1) .3s forwards'; }
  setBadge('dailyToday', vals[n - 1] + '%');
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
        <div class="leech-word"><span class="jp">${v.jp}</span><span class="read">${v.read}</span></div>
        <div class="leech-mid"><div class="mean">${v.mean}</div><div class="accwrap"><span class="accbar"><i style="width:${pct}%;animation-delay:${(0.45 + i * 0.05).toFixed(2)}s"></i></span><span class="accpct">${pct}%</span><span class="attempts">· ${att} attempt${att === 1 ? '' : 's'}</span></div></div>
        <div class="leech-act"><button class="pill review" data-rank="${v.rank}" title="Review ${v.jp} now">${mIcon(I.hist, 2)}Review</button></div>
      </div>`;
    }).join('') + '</div>';
  }
  // Per-card accuracy bars (worst-first, capped + show-all toggle).
  renderCardBars();
  // SRS memory pipeline (mock): six VERTICAL bars on the stone→jade Leitner ramp.
  // Heights are a compressed read on each box's count (the true count is the label);
  // a 0-count box is a short stub. The count sits inside tall bars (white) and floats
  // above short ones (ink). Box 5 = best-learned (jade label). The bar fill is set inline
  // as the dark gradient; stats.css overrides per-column in light (mock mechanism).
  const boxes = [0, 0, 0, 0, 0, 0]; // index = box 0..5
  state.DATA.forEach(v => { const c = state.store.cards[v.rank]; const b = c && c.box ? c.box : 0; boxes[b]++; });
  const boxName = ['New', 'Box 1', 'Box 2', 'Box 3', 'Box 4', 'Box 5'];
  const boxInt = ['unseen', '1 day', '2 days', '4 days', '8 days', '16 days'];
  setBadge('pipeBadge', total + (total === 1 ? ' card' : ' cards'));
  // bar height is PROPORTIONAL to the box count (mock: the tallest box → ~88%), so the
  // bars honestly reflect the numbers — NOT range-normalized, which squished the heights
  // whenever one box was an outlier. A small floor keeps tiny boxes visible; 0 → a stub.
  const maxBox = Math.max(...boxes, 1);
  const pcols = boxes.map((n, i) => {
    const h = n === 0 ? 3 : Math.max(7, Math.round(n / maxBox * 88));
    const above = h < 58;                                          // shorter bars float the count above
    const grad = `linear-gradient(180deg, color-mix(in srgb,var(--box-${i}) 68%, #fff) 0%, var(--box-${i}) 52%, color-mix(in srgb,var(--box-${i}) 80%, #000) 100%)`;
    return `<div class="pcol${i === 5 ? ' best' : ''}"><div class="pbar-track"><div class="pbar${above ? ' count-above' : ''}" style="height:${h}%;background:${grad};animation-delay:${(0.3 + i * 0.06).toFixed(2)}s"><span class="count">${n}</span></div></div><div class="plabel"><b>${boxName[i]}</b>${boxInt[i]}</div></div>`;
  }).join('');
  const swatches = boxes.map((n, i) => `<i style="background:var(--box-${i})"></i>`).join('');
  document.getElementById('boxDist').innerHTML = `<div class="pipeline">${pcols}</div><div class="pipe-legend"><span>least learned</span><span class="ramp"><span class="swatches">${swatches}</span></span><span>best learned</span></div>`;
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
