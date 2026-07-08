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
import { localDay } from '../config.js';
import { settings, saveSettings } from '../settings-store.js';
import {
  passes, isDue, dueCards, rollingAcc, reviewForecast, studyStreak,
  facetAll, DECK_FACETS, tokenFacet, filterSummary, clampRange,
  practiceStreak, examCountdown,
  isConjugable, CONJ_FORMS, CONJ_FORM_IDS,
} from '../core/index.js';

// Flashcard deck config — OWNED here. mode = test direction (`meaning`/`reading`/`conjugation`);
// forms = the inflections a conjugation session asks for (session-local, always ≥1 — see
// wireConjForms); cat/type/trans/topic/status = AND'd facets; ord = sort; rmin/rmax = rank band.
// Mutated in place by this module, by stats' studyLeeches, and read by flashcard; never
// reassigned, so a const object is right.
// rmax is finalized to state.MAXRANK in initDeckUI (state.MAXRANK isn't built yet at import).
export const cfg = { mode: 'meaning', forms: [...CONJ_FORM_IDS], input: 'self', audio: 'off', kind: 'free', cat: [], type: [], trans: [], topic: [], status: [], source: [], ord: 'shuffle', jlpt: ['all'], rmin: 1, rmax: 100 };

// Conjugation mode drills PRODUCTION, so it can only serve cards core/conjugation.js can inflect
// (verbs + adjectives with a known `type`, minus the forms it fails closed on). This narrows the
// deck ON TOP of the facets — a Nouns-only conjugation deck is legitimately empty. Applied by
// BOTH buildDeck and updateDeckCount so the "N cards in deck" readout can't promise cards the
// session won't deal.
const conjOk = v => cfg.mode !== 'conjugation' || isConjugable(v, cfg.forms);

// startSession lives in flashcard.js; injected to avoid a deck↔flashcard import cycle (the
// "callback registration in a thin main.js" seam). startDueSession calls it.
let onStartSession = () => {};
export function registerStartSession(fn) { onStartSession = fn; }

// repaintDeck = the .chip.deck group's paint() (created by wireFacets in initDeckUI). Other
// modules (stats studyLeeches) call it after mutating cfg directly. Module `let`, assigned
// at init — exported so importers see the live binding.
export let repaintDeck = () => {};

const forecastHorizon = 'week'; // the mock's forecast is a fixed 7-day side card (no toggle)
let rminEl = null, rmaxEl = null;

/* ---- Upcoming-review forecast ----
   reviewForecast() is pure (core/forecast.js); renderForecast() draws the editorial side-card
   bars (HTML/CSS — the mock's `.bars` grid, sized by --godan/--ichidan via flashcards.css).
   Leitner intervals top out at 16 days, so the month view captures the whole real schedule and
   the year view is front-loaded — accurate, not a bug. Every slot is drawn (empty days take the
   .bar min-height floor) so the full window stays legible even where nothing's due. */
export function renderForecast() {
  const el = document.getElementById('forecastChart'); if (!el) return;
  const { bars, max } = reviewForecast(forecastHorizon);
  const total = bars.reduce((s, b) => s + b.count, 0);
  if (!total) { el.innerHTML = '<div class="fcast-empty">No reviews scheduled in this window — drill some cards to start the clock.</div>'; return; }
  const n = bars.length, gap = n > 10 ? 4 : 13;                      // tighten the grid for dense windows
  let h = `<div class="bars" style="grid-template-columns:repeat(${n},1fr);gap:${gap}px" role="img" aria-label="Upcoming reviews over the next ${forecastHorizon}; ${total} scheduled">`;
  bars.forEach((b, i) => {
    const pct = b.count === 0 ? 0 : Math.max(16, Math.round((b.count / max) * 92));  // non-zero ≥16%; 92% leaves headroom
    const cls = b.now ? 'today' : (b.count === 0 ? 'tiny' : '');     // today = vermilion; empty = faint floor bar
    const showNum = n <= 7 || b.count > 0;                           // hide the wall of 0s on dense windows
    const tip = `${b.tip}: ${b.count} card${b.count === 1 ? '' : 's'}`;
    h += `<div class="bar-col${b.now ? ' is-today' : ''}" title="${tip}">`
      + `<div class="bar-track"><div class="bar ${cls}" style="height:${pct}%;animation-delay:${Math.min(i * 0.05, 0.7).toFixed(2)}s"></div></div>`
      + `<span class="bar-num">${showNum ? b.count : ''}</span>`
      + `<span class="bar-day">${b.label || ''}</span>`
      + '</div>';
  });
  el.innerHTML = h + '</div>';
}

/* ---- SRS pipeline (subway line) ----
   The whole deck's Leitner box distribution (New → Box 1-4 → Mastered) drawn as a metro line:
   one dot per box (filled when it holds cards), the busiest box marked .cur ("you are here"),
   counts above / interval labels below. A pure box tally off state.store.cards — no schedule
   math (that's renderForecast). Styled in flashcards.css (.pipe/.lineviz/.stop/.dot/.seg). */
const PIPE_STOPS = ['New', 'Box 1 · 1d', 'Box 2 · 2d', 'Box 3 · 4d', 'Box 4 · 8d', 'Mastered · 16d'];
export function renderPipeline() {
  const viz = document.getElementById('pipeViz'); if (!viz) return;
  const counts = [0, 0, 0, 0, 0, 0];
  const cards = state.store.cards || {};
  for (const v of state.DATA) { const b = Math.min((cards[v.rank] && cards[v.rank].box) || 0, 5); counts[b]++; }
  const cur = counts.indexOf(Math.max(...counts));   // the busiest box = "you are here"
  let h = '';
  for (let i = 0; i < 6; i++) {
    h += `<div class="stop${i === cur ? ' cur' : ''}"><b>${counts[i]}</b><span class="dot${counts[i] > 0 ? ' fill' : ''}"></span><em>${PIPE_STOPS[i]}</em></div>`;
    if (i < 5) h += '<span class="seg"></span>';
  }
  viz.innerHTML = h;
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

/* ---- Conjugation-mode form picker ----
   Its own chip group (not a deck facet): `forms` filters which QUESTION a card is asked, not
   which cards exist, so it can't ride TOKEN_FACET/wireFacets. Multi-select with a floor of one
   — deselecting the last form would empty the deck with no way back, so the last active chip
   ignores its own click. The row only exists in conjugation mode (syncConjRow). */
function syncConjRow() {
  const row = document.getElementById('conjFormsRow');
  if (row) row.hidden = cfg.mode !== 'conjugation';
}
function wireConjForms() {
  const box = document.getElementById('conjForms');
  if (!box) return;
  box.innerHTML = CONJ_FORMS.map(f =>
    `<button class="chip conjf active" type="button" data-conjf="${f.id}">${f.label} <span class="jp">${f.jp}</span></button>`).join('');
  box.addEventListener('click', e => {
    const b = e.target.closest('.conjf'); if (!b) return;
    const id = b.dataset.conjf, i = cfg.forms.indexOf(id);
    if (i >= 0) { if (cfg.forms.length === 1) return; cfg.forms.splice(i, 1); }   // keep ≥1
    else cfg.forms.push(id);
    b.classList.toggle('active', cfg.forms.includes(id));
    updateDeckCount();
  });
  syncConjRow();
}

// Build the ordered list of cards for a session from the current cfg. shuffle = in-place
// Fisher–Yates; worst-first treats never-drilled cards as 100% so they sort to the back.
export function buildDeck() {
  let d = state.DATA.filter(v => passes(v, cfg) && conjOk(v));
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
  const n = state.DATA.filter(v => passes(v, cfg) && conjOk(v) && (cfg.kind !== 'srs' || isDue(v.rank))).length;
  document.getElementById('deckCount').innerHTML = `<b>${n}</b> ${cfg.kind === 'srs' ? 'due in this deck' : 'cards in deck'}`;
  const parts = filterSummary(cfg);
  // Conjugation mode is a real narrowing of the deck, so it belongs in the recap — otherwise a
  // deck that just shed every noun looks like the facets misfired.
  if (cfg.mode === 'conjugation') parts.push('conjugation: ' + cfg.forms.map(f => (CONJ_FORMS.find(x => x.id === f) || {}).jp || f).join(' · '));
  paintSummary('deckSummary', parts);
}
// SRS hero: the giant due count (flips to the green "all caught up" state at 0), the streak +
// studied-today meta, and the forecast — all reflect the schedule, so they refresh together.
export function updateDueBanner() {
  const n = dueCards().length;
  document.getElementById('dueCount').textContent = String(n);   // explicit: textContent = 0 (number) renders '' in some DOM impls
  const banner = document.getElementById('dueBanner');
  banner.classList.toggle('empty', n === 0);
  document.getElementById('dueBtn').disabled = n === 0;
  document.getElementById('dueBtn').innerHTML = n === 0
    ? '<svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>All caught up'
    : 'Review due cards<span class="arr"><svg class="ic" aria-hidden="true"><use href="#i-arrow-right"/></svg></span>';
  // Hero meta: the day streak pill (hidden at 0 — stays alive across a not-yet-studied today)
  // and today's review tally over the deck size, mirroring the mock.
  const daily = state.store.daily || {}, today = localDay();
  const streak = studyStreak(daily, today);
  const streakEl = document.getElementById('heroStreak');
  if (streakEl) { streakEl.hidden = streak < 1; const b = streakEl.querySelector('b'); if (b) b.textContent = 'Day ' + streak; }
  // Cross-tab daily-loop pills: the SPEAKING streak (独り言/歌 takes, invisible outside those
  // tabs before this) and the JLPT countdown — both jump to their tab (wired in initDeckUI).
  const speakEl = document.getElementById('heroSpeak');
  if (speakEl) {
    const sp = practiceStreak(state.selftalkStore.practice, today);
    speakEl.hidden = sp < 1;
    const b = speakEl.querySelector('b'); if (b) b.textContent = 'Day ' + sp;
  }
  const jlptEl = document.getElementById('heroJlpt');
  if (jlptEl) {
    const cd = examCountdown((state.jlptStore || {}).examDate, Date.now());
    jlptEl.hidden = !cd || cd.past;
    if (cd && !cd.past) {
      const lv = document.getElementById('heroJlptLevel'); if (lv) lv.textContent = state.jlptStore.level || 'N3';
      const d = document.getElementById('heroJlptDays'); if (d) d.textContent = cd.days === 0 ? 'today!' : `in ${cd.days} day${cd.days === 1 ? '' : 's'}`;
    }
  }
  const studiedEl = document.getElementById('heroStudied');
  if (studiedEl) { const done = (daily[today] && daily[today].tot) || 0; studiedEl.innerHTML = `<b>${done}</b> of <b>${state.DATA.length}</b> studied today`; }
  renderForecast();
  renderPipeline();
}
// Shared "override the picker, scope the deck, sync the chip UI, and start a run" jump — used
// by the review-due flow and the four cross-tab "study these now" CTAs below. Resets ALL six
// DECK_FACETS + kind/range/order to a clean baseline, applies the caller's `overrides`, mirrors
// the resulting cfg back onto the picker chips + range inputs, then starts. ONE reset path so a
// newly-added facet can't be applied to some copies and missed in others (cfg.cat once was —
// see the startDueSession regression pinned in deck-render.test.js). rmax resets to the REAL top
// rank (state.MAXRANK; a hardcoded 100 excluded every due/leech custom/Minna/song/鰐蟹 card).
// Callers that jump from another tab click the study tab themselves first — startDueSession is
// already on the study tab, so it doesn't.
function launchDeck(overrides) {
  cfg.kind = 'free'; cfg.cat = []; cfg.type = []; cfg.trans = []; cfg.topic = [];
  cfg.status = []; cfg.source = []; cfg.jlpt = ['all']; cfg.rmin = 1; cfg.rmax = state.MAXRANK; cfg.ord = 'worst';
  Object.assign(cfg, overrides);
  repaintDeck();
  document.querySelectorAll('.chip.skind').forEach(x => x.classList.toggle('active', x.dataset.skind === cfg.kind));
  document.querySelectorAll('.chip.jlpt').forEach(x => x.classList.toggle('active', cfg.jlpt.includes(x.dataset.jlpt)));
  document.getElementById('rmin').value = cfg.rmin; document.getElementById('rmax').value = cfg.rmax;
  document.querySelectorAll('.chip.ord').forEach(x => x.classList.toggle('active', x.dataset.ord === cfg.ord));
  updateStartLabel();
  onStartSession();
}

// "Review due cards": force the deck to due-only, worst-first, full range (a dedicated review
// flow that overrides the picker). Already on the study tab, so no tab jump.
export function startDueSession() {
  launchDeck({ kind: 'srs', status: ['due'] });
}

// "Study the 鰐蟹 deck now": jump to the flashcard tab scoped to WK-activated cards in FREE
// study (fresh activations aren't due yet — free mode makes them reviewable immediately) and
// start. The wanikani tab's post-activation CTA.
export function studyWkCards() {
  document.querySelector('.tab[data-tab="study"]').click();
  launchDeck({ source: ['wanikani'] });
}

// "Drill grammar": the same jump scoped to the grammar CATEGORY (cloze cards) — the JLPT tab's
// grammar-lens CTA. Free study: fresh activations aren't due yet.
export function studyGrammarDeck() {
  document.querySelector('.tab[data-tab="study"]').click();
  launchDeck({ cat: ['grammar'] });
}

// "Study them now" (合格 gap-fill): the same jump scoped to Source: JLPT cards.
export function studyJlptCards() {
  document.querySelector('.tab[data-tab="study"]').click();
  launchDeck({ source: ['jlptfill'] });
}

// "Study all leeches": the same jump scoped to leech cards (leeches aren't necessarily due —
// free mode makes them reviewable now). Shared by Stats + the JLPT tab's checklist (the old
// stats copy hardcoded rmax=100, silently excluding every custom/Minna/song/鰐蟹 leech).
export function studyLeechCards() {
  document.querySelector('.tab[data-tab="study"]').click();
  launchDeck({ status: ['leech'] });
}

// Wire the deck picker chips + range inputs + forecast horizon toggle. Runs after the data
// build, so state.MAXRANK is final here (cfg.rmax is set to it).
export function initDeckUI() {
  cfg.rmax = state.MAXRANK;
  cfg.input = settings.input;
  cfg.audio = settings.audio;
  // The hero's cross-tab pills jump to their tabs (chrome's initTabs handles the render).
  const jump = (id, tab) => { const el = document.getElementById(id); if (el) el.addEventListener('click', () => { const t = document.querySelector(`.tab[data-tab="${tab}"]`); if (t) t.click(); }); };
  jump('heroSpeak', 'selftalk');
  jump('heroJlpt', 'jlpt');
  document.querySelectorAll('.chip.mode').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.chip.mode').forEach(x => x.classList.remove('active')); b.classList.add('active'); cfg.mode = b.dataset.mode;
    syncConjRow(); updateDeckCount();
  }));
  wireConjForms();
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
}
function syncRange() {
  const [lo, hi] = clampRange(rminEl.value, rmaxEl.value, state.MAXRANK);
  cfg.rmin = lo; cfg.rmax = hi; updateDeckCount();
}
