// 合格 JLPT tab — the vocabulary-readiness lens, split out of view.js (refactor-jlpt-view-split,
// step 7b): readinessHtml (the deck + WaniKani coverage bars against the bundled JLPT list, plus
// the Momentum stat grid) and its internal gapFillHtml (the union line + today's gap-fill batch
// preview + the one-tap add). gapFillHtml is internal — only readinessHtml renders it.
import { state } from '../../state.js';
import { deckJlptCoverage, wkJlptCoverage, selectGapBatch, escapeHtml } from '../../core/index.js';
import { jlptMap, jlptWords } from './data.js';
import { jlptDeckCount } from './activate.js';
import { S as WK } from '../wanikani/state.js';

export function readinessHtml(store, sig) {
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
