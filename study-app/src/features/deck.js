// DECK BUILDING — the filter model + the flashcard deck picker + the SRS due banner +
// the upcoming-review forecast.
//
// THE MENTAL MODEL (read before touching passes()): a card is shown iff it satisfies ALL
// of (Category/Type/Trans/Topic/Status facet) AND (JLPT facet) AND (rank in range). Within
// one facet the selected tokens OR; across facets they AND. An empty facet array = "no
// constraint". passes()/facetAll/tokenFacet/etc. are the pure core (core/facets.js); this
// module is the DOM wiring + the two mutable configs' study half (cfg). bcfg (Browse) lives
// in features/browse.js but reuses makeMultiSelect/wireFacets/paintSummary/syncVerbRows
// exported here.
import { state } from '../state.js';
import { settings, saveSettings } from '../settings-store.js';
import {
  passes, isDue, dueCards, rollingAcc, reviewForecast,
  facetAll, DECK_FACETS, tokenFacet, filterSummary,
} from '../core/index.js';

// Flashcard deck config — OWNED here. mode = test direction; cat/type/trans/topic/status =
// AND'd facets; ord = sort; rmin/rmax = rank band. Mutated in place by this module, by
// stats' studyLeeches, and read by flashcard; never reassigned, so a const object is right.
// rmax is finalized to state.MAXRANK in initDeckUI (state.MAXRANK isn't built yet at import).
export const cfg = { mode: 'meaning', input: 'self', audio: 'off', kind: 'free', cat: [], type: [], trans: [], topic: [], status: [], source: [], ord: 'shuffle', jlpt: ['all'], rmin: 1, rmax: 100 };

// startSession lives in flashcard.js; injected to avoid a deck↔flashcard import cycle (the
// "callback registration in a thin main.js" seam). startDueSession calls it.
let onStartSession = () => {};
export function registerStartSession(fn) { onStartSession = fn; }

// repaintDeck = the .chip.deck group's paint() (created by wireFacets in initDeckUI). Other
// modules (stats studyLeeches) call it after mutating cfg directly. Module `let`, assigned
// at init — exported so importers see the live binding.
export let repaintDeck = () => {};

let forecastHorizon = 'week';   // '24h' | 'week' | 'month' | 'year' — view-only, not synced
let rminEl = null, rmaxEl = null;

/* ---- Upcoming-review forecast ----
   reviewForecast() is pure (core/forecast.js); renderForecast() draws the hand-rolled
   vertical-bar SVG. Leitner intervals top out at 16 days, so the month view captures the
   whole real schedule and the year view is front-loaded — accurate, not a bug. */
export function renderForecast() {
  const el = document.getElementById('forecastChart'); if (!el) return;
  const { bars, max } = reviewForecast(forecastHorizon);
  const total = bars.reduce((s, b) => s + b.count, 0);
  if (!total) { el.innerHTML = '<div class="fcast-empty">No reviews scheduled in this window — drill some cards to start the clock.</div>'; return; }
  const n = bars.length, W = 720, H = 156, pad = { l: 8, r: 8, t: 18, b: 22 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b, base = pad.t + ih;
  const bw = iw / n, gap = Math.min(6, bw * 0.22);
  const yOf = c => base - (max ? c / max : 0) * ih;
  let g = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Upcoming reviews over the next ${forecastHorizon}; ${total} scheduled">`;
  // Every slot gets a faint background box so the full time breakdown is visible even where
  // nothing is due (24 hours / 7 days / a month of days / 12 months).
  bars.forEach((b, i) => {
    const x = (pad.l + i * bw + gap / 2).toFixed(1), bwid = (bw - gap).toFixed(1), cx = (pad.l + i * bw + bw / 2).toFixed(1);
    g += `<rect x="${x}" y="${pad.t.toFixed(1)}" width="${bwid}" height="${ih.toFixed(1)}" rx="2" fill="var(--paper-2)" opacity="0.55"/>`;
    if (b.count) {
      const y = yOf(b.count), col = b.now ? 'var(--godan)' : 'var(--ichidan)';
      g += `<rect class="fbar" x="${x}" y="${y.toFixed(1)}" width="${bwid}" height="${(base - y).toFixed(1)}" rx="2" fill="${col}" opacity="0.92"><title>${b.tip}: ${b.count} card${b.count === 1 ? '' : 's'}</title></rect>`;
      g += `<text x="${cx}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--muted)" font-family="monospace">${b.count}</text>`;
    }
    if (b.label) g += `<text x="${cx}" y="${H - 7}" text-anchor="middle" font-size="8" fill="var(--muted)" font-family="monospace">${b.label}</text>`;
  });
  g += `<line x1="${pad.l}" y1="${base.toFixed(1)}" x2="${W - pad.r}" y2="${base.toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`;
  g += '</svg>';
  el.innerHTML = g;
}

/* Generic multi-select chip group. Reused for both cfg and bcfg facets. 'all' is exclusive;
   deselecting the last specific token falls back to ['all']. paint() syncs .active. */
export function makeMultiSelect(selector, getArr, setArr, attr, onChange) {
  const btns = document.querySelectorAll(selector);
  function paint() {
    const arr = getArr();
    btns.forEach(b => b.classList.toggle('active', arr.includes(b.dataset[attr]) || (facetAll(arr) && b.dataset[attr] === 'all')));
  }
  btns.forEach(b => b.addEventListener('click', () => {
    const val = b.dataset[attr];
    let arr = getArr().filter(x => x !== 'all'); // work on the set sans 'all'
    if (val === 'all') { arr = []; }
    else if (arr.includes(val)) { arr = arr.filter(x => x !== val); } // toggle off
    else { arr.push(val); }                                   // toggle on
    setArr(arr.length ? arr : ['all']);
    paint(); onChange();
  }));
  paint();
}

// ---- AND'd-facet chip wiring ----
const deckEmpty = c => DECK_FACETS.every(f => !c[f].length);
// Wire a chip group (.deck or .bf) to a config's facet arrays. Tokens toggle within their
// derived facet (OR); the lone "all" token clears every facet (master reset). Returns
// paint() so deep-links can resync the chips after mutating the config directly.
export function wireFacets(selector, c, onChange) {
  const chips = [...document.querySelectorAll(selector)];
  const tokenOf = b => b.dataset.deck || b.dataset.filter;
  function paint() {
    chips.forEach(b => { const t = tokenOf(b);
      b.classList.toggle('active', t === 'all' ? deckEmpty(c) : c[tokenFacet(t)].includes(t)); });
  }
  chips.forEach(b => b.addEventListener('click', () => {
    const t = tokenOf(b);
    if (t === 'all') { DECK_FACETS.forEach(f => c[f] = []); }
    else { const arr = c[tokenFacet(t)], i = arr.indexOf(t); if (i >= 0) arr.splice(i, 1); else arr.push(t); }
    paint(); onChange();
  }));
  paint();
  return paint;
}

// Reflect cfg.kind on the Start button so it's clear which session you're about to run.
export function updateStartLabel() {
  const el = document.getElementById('startBtn'); if (!el) return;
  el.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-play"/></svg>' + (cfg.kind === 'srs' ? 'Start SRS review' : 'Start free study');
}

// Single-select chip pattern (Input / Audio). paintPrefChips repaints from settings (boot +
// when settings change externally — Settings page / cloud pull).
function bindSingle(selector, attr, onSet) {
  document.querySelectorAll(selector).forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll(selector).forEach(x => x.classList.remove('active'));
    b.classList.add('active'); onSet(b.dataset[attr]);
  }));
}
export function paintPrefChips() {
  cfg.input = settings.input; cfg.audio = settings.audio;
  document.querySelectorAll('.chip.imode').forEach(x => x.classList.toggle('active', x.dataset.imode === settings.input));
  document.querySelectorAll('.chip.amode').forEach(x => x.classList.toggle('active', x.dataset.amode === settings.audio));
}

// Build the ordered list of cards for a session from the current cfg. shuffle = in-place
// Fisher–Yates; worst-first treats never-drilled cards as 100% so they sort to the back.
export function buildDeck() {
  let d = state.DATA.filter(v => passes(v, cfg));
  if (cfg.kind === 'srs') d = d.filter(v => isDue(v.rank));   // SRS review = due cards only
  if (cfg.ord === 'shuffle') { for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; } }
  else if (cfg.ord === 'freq') { d.sort((a, b) => a.rank - b.rank); }
  else if (cfg.ord === 'worst') { d.sort((a, b) => { const ra = rollingAcc(a.rank) ?? 1, rb = rollingAcc(b.rank) ?? 1; return ra - rb; }); }
  return d;
}

// Paint the filter recap into a #id element; hidden (:empty) when nothing is filtered.
export function paintSummary(id, parts) {
  const el = document.getElementById(id); if (!el) return;
  el.innerHTML = parts.length
    ? '<svg class="ic" aria-hidden="true"><use href="#i-filter"/></svg>Filtering: ' + parts.map(p => '<b>' + p + '</b>').join(' · ')
    : '';
}
// Hide the verb-only filter rows (Type / Transitivity) when the Category facet excludes
// verbs; clear any stranded type/trans tokens. Per-panel (config + its repaint fn).
export function syncVerbRows(sel, c, repaint) {
  const show = !c.cat.length || c.cat.includes('verb');
  document.querySelectorAll(sel + ' .frow.verb-only').forEach(r => { r.style.display = show ? '' : 'none'; });
  if (!show && (c.type.length || c.trans.length)) { c.type = []; c.trans = []; repaint(); }
}
// Live "N cards in deck" readout under the Start button + filter recap.
export function updateDeckCount() {
  syncVerbRows('#panel-study', cfg, repaintDeck);
  const n = state.DATA.filter(v => passes(v, cfg) && (cfg.kind !== 'srs' || isDue(v.rank))).length;
  document.getElementById('deckCount').innerHTML = `<b>${n}</b> ${cfg.kind === 'srs' ? 'due in this deck' : 'cards in deck'}`;
  paintSummary('deckSummary', filterSummary(cfg));
}
// SRS banner: count due cards, flip to the green "all caught up" state at 0.
export function updateDueBanner() {
  const n = dueCards().length;
  document.getElementById('dueCount').textContent = n;
  const banner = document.getElementById('dueBanner');
  banner.classList.toggle('empty', n === 0);
  document.getElementById('dueBtn').disabled = n === 0;
  document.getElementById('dueBtn').innerHTML = n === 0
    ? '<svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>All caught up'
    : '<svg class="ic" aria-hidden="true"><use href="#i-play"/></svg>Review due cards';
  renderForecast();   // the due count and the forecast both reflect the schedule — refresh together
}
// "Review due cards": force the deck to due-only, worst-first, full range, and reflect that
// in the chip UI before starting. Overrides the picker on purpose — a dedicated review flow.
export function startDueSession() {
  cfg.kind = 'srs'; cfg.type = []; cfg.trans = []; cfg.topic = []; cfg.status = ['due']; cfg.source = []; cfg.jlpt = ['all']; cfg.rmin = 1; cfg.rmax = 100; cfg.ord = 'worst';
  repaintDeck();
  document.querySelectorAll('.chip.skind').forEach(x => x.classList.toggle('active', x.dataset.skind === 'srs'));
  document.querySelectorAll('.chip.jlpt').forEach(x => x.classList.toggle('active', x.dataset.jlpt === 'all'));
  document.getElementById('rmin').value = 1; document.getElementById('rmax').value = 100;
  document.querySelectorAll('.chip.ord').forEach(x => x.classList.toggle('active', x.dataset.ord === 'worst'));
  updateStartLabel();
  onStartSession();
}

// Wire the deck picker chips + range inputs + forecast horizon toggle. Runs after the data
// build, so state.MAXRANK is final here (cfg.rmax is set to it).
export function initDeckUI() {
  cfg.rmax = state.MAXRANK;
  cfg.input = settings.input;
  cfg.audio = settings.audio;
  document.querySelectorAll('.chip.mode').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.chip.mode').forEach(x => x.classList.remove('active')); b.classList.add('active'); cfg.mode = b.dataset.mode; updateDeckCount();
  }));
  document.querySelectorAll('.chip.skind').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.chip.skind').forEach(x => x.classList.remove('active')); b.classList.add('active');
    cfg.kind = b.dataset.skind; updateDeckCount(); updateStartLabel();
  }));
  bindSingle('.chip.imode', 'imode', v => { cfg.input = v; settings.input = v; saveSettings(); });
  bindSingle('.chip.amode', 'amode', v => { cfg.audio = v; settings.audio = v; saveSettings(); });
  paintPrefChips();
  repaintDeck = wireFacets('.chip.deck', cfg, updateDeckCount);
  makeMultiSelect('.chip.jlpt', () => cfg.jlpt, a => cfg.jlpt = a, 'jlpt', updateDeckCount);
  document.querySelectorAll('.chip.ord').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.chip.ord').forEach(x => x.classList.remove('active')); b.classList.add('active'); cfg.ord = b.dataset.ord;
  }));
  // Rank-range inputs. syncRange clamps to 1..MAXRANK and auto-swaps if lo>hi.
  rminEl = document.getElementById('rmin'); rmaxEl = document.getElementById('rmax');
  rminEl.addEventListener('change', syncRange);
  rmaxEl.addEventListener('change', syncRange);
  document.querySelectorAll('.chip.rpreset').forEach(b => b.addEventListener('click', () => {
    rminEl.value = b.dataset.lo; rmaxEl.value = b.dataset.hi; syncRange();
  }));
  // Forecast horizon toggle (24h/week/month/year): view-only, re-renders the bars.
  document.getElementById('fcHorizons').addEventListener('click', e => {
    const b = e.target.closest('.fch'); if (!b) return;
    forecastHorizon = b.dataset.h;
    document.querySelectorAll('.fch').forEach(x => x.classList.toggle('active', x === b));
    renderForecast();
  });
}
function syncRange() {
  let lo = parseInt(rminEl.value) || 1, hi = parseInt(rmaxEl.value) || state.MAXRANK;
  lo = Math.max(1, Math.min(state.MAXRANK, lo)); hi = Math.max(1, Math.min(state.MAXRANK, hi));
  if (lo > hi) { const t = lo; lo = hi; hi = t; }
  cfg.rmin = lo; cfg.rmax = hi; updateDeckCount();
}
