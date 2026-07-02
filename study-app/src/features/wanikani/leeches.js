// 苦手 Leeches view — the reason this tab exists. Three sections: an EXAM-FOCUS bar
// (the target-JLPT slice of the leech list, with a one-tap bulk add — the highest-value
// fixes before the test date), same-kanji CONFUSION GROUPS (a leech vocab shown beside
// every other started word using the same kanji — the "same kanji, slightly different
// meaning" trap laid out side-by-side), then the full ranked leech list (searchable +
// JLPT-filterable — 331 leeches need narrowing, not just scrolling). Scoring/clustering
// is pure core (buildLeeches / confusionClusters); this module renders — and since
// wk-leech-to-deck it also renders the TREATMENT affordances: bulk "add to deck",
// per-family drill buttons, in-deck badges, and the "study now" jump into the
// flashcard tab (activate.js does the work).
import { S } from './state.js';
import { state } from '../../state.js';
import { buildLeeches, confusionClusters, subjectMatches, wkEscape, primaryMeaning, primaryReading } from '../../core/index.js';
import { subjectRowHtml, charHtml } from './bits.js';
import { wkDeckIndex, wkInDeck, activatableWk, wkDeckCount } from './activate.js';
import { jlptOf, jlptMap } from '../jlpt/data.js';

const LIST_CAP = 60;
const CLUSTER_CAP = 12;

// The current leech ranking (worst-first). Recomputed per render — 3.5k stats is
// sub-millisecond, no caching needed.
export function leechList() {
  if (!S.loaded) return [];
  return buildLeeches([...S.stats.values()], S.assignments, S.subjects);
}

// The same-kanji clusters for the current leech list (view.js's addcluster action
// re-derives them through this, so the button and the render can't disagree).
export function leechClusters() {
  return confusionClusters(leechList(), S.subjects, S.assignments);
}

// The target-JLPT slice of the leech list (the exam lens; [] before the word-list
// chunk loads). view.js's addfocus action re-derives through this too.
export function focusLeeches() {
  const target = (state.jlptStore || {}).level;
  if (!target || !jlptMap()) return [];
  return leechList().filter((l) => jlptOf(l.subject.chars, primaryReading(l.subject)) === target);
}

export function leechesHtml() {
  const leeches = leechList();
  if (!leeches.length) {
    return `<section class="wk-card"><div class="wk-empty">No leeches right now — every wobbly item has recovered its streak. 完璧です。</div></section>`;
  }
  const idx = wkDeckIndex();
  return focusHtml(leeches, idx) + clustersHtml(leechClusters(), idx) + listHtml(leeches, idx);
}

/* ---- exam-focus bar --------------------------------------------------------------- */

// "N of your leeches are N3 vocabulary" + a one-tap bulk add of the not-yet-activated
// ones. Only renders when the target level actually intersects the leech list.
function focusHtml(leeches, idx) {
  const target = (state.jlptStore || {}).level;
  const focus = focusLeeches();
  if (!focus.length) return '';
  const addable = activatableWk(focus.map((l) => l.subject), idx).length;
  return `<section class="wk-card wk-focusbar">
    <div class="wk-focus-main">
      <span class="wk-focus-seal jp-min" aria-hidden="true">${target}</span>
      <div><b>${focus.length} of your ${leeches.length} leeches ${focus.length === 1 ? 'is' : 'are'} ${target} vocabulary</b>
      <div class="sub">the highest-value fixes on this list — the exam draws from exactly these words</div></div>
    </div>
    ${addable
      ? `<button class="chip wk-addbtn" data-wk-act="addfocus"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg>Add ${addable} ${target} leech${addable === 1 ? '' : 'es'} to deck</button>`
      : `<span class="wk-indeck-note"><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>all in your deck — drill them from the study tab</span>`}
  </section>`;
}

/* ---- confusion groups ---------------------------------------------------------- */

function clustersHtml(clusters, idx) {
  if (!clusters.length) return '';
  const shown = clustersExpanded ? clusters : clusters.slice(0, CLUSTER_CAP);
  const cards = shown.map((c) => {
    const k = c.kanji;
    const members = c.members.map((m) => subjectRowHtml(m.subject, { leech: m.isLeech, inDeck: wkInDeck(m.subject, idx) })).join('');
    const addable = activatableWk(c.members.map((m) => m.subject), idx).length;
    const foot = addable
      ? `<button class="chip wk-addbtn" data-wk-act="addcluster" data-id="${k.id}"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg>Drill this family — add ${addable} word${addable === 1 ? '' : 's'} to deck</button>`
      : `<span class="wk-indeck-note"><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>family in your deck</span>`;
    return `<div class="wk-cluster">
      <button class="wk-cluster-kanji" data-wk-act="open" data-id="${k.id}" title="${wkEscape(primaryMeaning(k))}">
        <span class="wk-cluster-char">${charHtml(k)}</span>
        <span class="wk-cluster-info"><b>${wkEscape(primaryMeaning(k))}</b><span class="jp">${wkEscape(primaryReading(k))}</span></span>
      </button>
      <div class="wk-cluster-members">${members}</div>
      <div class="wk-cluster-foot">${foot}</div>
    </div>`;
  }).join('');
  return `<section class="wk-card wk-clusters-card">
    <div class="wk-card-head"><div><h2 class="title"><span class="jp-min">混同注意</span> · Same-kanji confusion</h2>
      <div class="sub">each leech beside every word you know that shares its kanji — drill the family together, the differences stick</div></div>
      <span class="wk-card-badge leech">${clusters.length} group${clusters.length === 1 ? '' : 's'}</span></div>
    <div class="wk-clusters">${cards}</div>
    ${clusters.length > shown.length ? `<button class="chip wk-morebtn" data-wk-act="clustermore">Show all ${clusters.length} groups</button>` : ''}
  </section>`;
}

/* ---- full ranked list ------------------------------------------------------------ */

let expanded = false;
let clustersExpanded = false;
export function resetLeechExpand() { expanded = false; clustersExpanded = false; }

// Apply the list's view filters (search text + JLPT chip) to the ranked leeches.
export function filteredLeeches(leeches) {
  let out = leeches;
  if (S.leechQ) out = out.filter((l) => subjectMatches(l.subject, S.leechQ));
  if (S.leechJlpt) out = out.filter((l) => jlptOf(l.subject.chars, primaryReading(l.subject)) === S.leechJlpt);
  return out;
}

// The JLPT filter chips: only levels that actually occur in the leech list (plus "all"),
// hidden entirely until the word-list chunk is up. '?' (unlisted) is not a chip — the
// "all" state covers it.
function jlptChipsHtml(leeches) {
  if (!jlptMap()) return '';
  const counts = {};
  for (const l of leeches) { const lv = jlptOf(l.subject.chars, primaryReading(l.subject)); if (lv) counts[lv] = (counts[lv] || 0) + 1; }
  const levels = ['N5', 'N4', 'N3', 'N2', 'N1'].filter((lv) => counts[lv]);
  if (!levels.length) return '';
  return `<span class="wk-browse-chips" role="group" aria-label="JLPT filter">
    <button class="wk-minichip${!S.leechJlpt ? ' active' : ''}" data-wk-act="ljlpt" data-level="">all</button>
    ${levels.map((lv) => `<button class="wk-minichip${S.leechJlpt === lv ? ' active' : ''}" data-wk-act="ljlpt" data-level="${lv}">${lv} · ${counts[lv]}</button>`).join('')}
  </span>`;
}

function listHtml(leeches, idx) {
  const filtered = filteredLeeches(leeches);
  const shown = expanded ? filtered : filtered.slice(0, LIST_CAP);
  const rows = shown.map((l) => subjectRowHtml(l.subject, { leech: false, score: true, inDeck: wkInDeck(l.subject, idx) })).join('');
  const addable = activatableWk(filtered.map((l) => l.subject), idx).length;
  const filterOn = !!(S.leechQ || S.leechJlpt);
  const deck = wkDeckCount();
  return `<section class="wk-card">
    <div class="wk-card-head"><div><h2 class="title">All leeches</h2>
      <div class="sub">score = misses ÷ current streak<sup>1.5</sup>, worse side of meaning/reading · tap for mnemonics & family</div></div>
      <span class="wk-leech-actions">
        ${deck.n ? `<button class="chip wk-studybtn" data-wk-act="studywk"><svg class="ic" aria-hidden="true"><use href="#i-cards"/></svg>Study 鰐蟹 deck${deck.due ? ` · ${deck.due} due` : ` · ${deck.n}`}</button>` : ''}
        ${addable ? `<button class="chip wk-addbtn" data-wk-act="addleeches"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg>Add ${filterOn ? `these ${addable}` : `all ${addable}`} to deck</button>` : ''}
        <span class="wk-card-badge leech">${filterOn ? `${filtered.length} of ${leeches.length}` : leeches.length}</span>
      </span></div>
    <div class="wk-leech-filters">
      <span class="search-wrap wk-searchwrap"><svg class="ic" aria-hidden="true"><use href="#i-search"/></svg>
        <input class="search" id="wkLeechQ" placeholder="Search your leeches — kanji, reading, or meaning…" value="${wkEscape(S.leechQ)}"></span>
      ${jlptChipsHtml(leeches)}
    </div>
    <div id="wkLeechRows">
      ${filtered.length ? `<div class="wk-rows">${rows}</div>` : '<div class="wk-empty">No leech matches that filter.</div>'}
      ${filtered.length > LIST_CAP && !expanded ? `<button class="chip wk-morebtn" data-wk-act="leechmore">Show all ${filtered.length}</button>` : ''}
    </div>
  </section>`;
}

// The list body alone — swapped in place on search keystrokes so the input keeps focus
// (the wkSearch pattern). Same filter path as listHtml.
export function leechRowsHtml() {
  const idx = wkDeckIndex();
  const filtered = filteredLeeches(leechList());
  const shown = expanded ? filtered : filtered.slice(0, LIST_CAP);
  const rows = shown.map((l) => subjectRowHtml(l.subject, { leech: false, score: true, inDeck: wkInDeck(l.subject, idx) })).join('');
  return `<div id="wkLeechRows">
    ${filtered.length ? `<div class="wk-rows">${rows}</div>` : '<div class="wk-empty">No leech matches that filter.</div>'}
    ${filtered.length > LIST_CAP && !expanded ? `<button class="chip wk-morebtn" data-wk-act="leechmore">Show all ${filtered.length}</button>` : ''}
  </div>`;
}

// The "show all" toggles live here beside their state; view.js routes the actions.
export function expandLeeches() { expanded = true; }
export function expandClusters() { clustersExpanded = true; }
