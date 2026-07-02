// 苦手 Leeches view — the reason this tab exists. Two sections: same-kanji CONFUSION
// GROUPS (a leech vocab shown beside every other started word using the same kanji —
// the "same kanji, slightly different meaning" trap laid out side-by-side), then the
// full ranked leech list. Scoring/clustering is pure core (buildLeeches /
// confusionClusters); this module renders — and since wk-leech-to-deck it also renders
// the TREATMENT affordances: bulk "add to deck", per-family drill buttons, in-deck
// badges, and the "study now" jump into the flashcard tab (activate.js does the work).
import { S } from './state.js';
import { buildLeeches, confusionClusters, wkEscape, primaryMeaning, primaryReading } from '../../core/index.js';
import { subjectRowHtml, charHtml } from './bits.js';
import { wkDeckIndex, wkInDeck, activatableWk, wkDeckCount } from './activate.js';

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

export function leechesHtml() {
  const leeches = leechList();
  if (!leeches.length) {
    return `<section class="wk-card"><div class="wk-empty">No leeches right now — every wobbly item has recovered its streak. 完璧です。</div></section>`;
  }
  const idx = wkDeckIndex();
  return clustersHtml(leechClusters(), idx) + listHtml(leeches, idx);
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

function listHtml(leeches, idx) {
  const shown = expanded ? leeches : leeches.slice(0, LIST_CAP);
  const rows = shown.map((l) => subjectRowHtml(l.subject, { leech: false, score: true, inDeck: wkInDeck(l.subject, idx) })).join('');
  const addable = activatableWk(leeches.map((l) => l.subject), idx).length;
  const inDeck = wkDeckCount();
  return `<section class="wk-card">
    <div class="wk-card-head"><div><h2 class="title">All leeches</h2>
      <div class="sub">score = misses ÷ current streak<sup>1.5</sup>, worse side of meaning/reading · tap for mnemonics & family</div></div>
      <span class="wk-leech-actions">
        ${inDeck ? `<button class="chip wk-studybtn" data-wk-act="studywk"><svg class="ic" aria-hidden="true"><use href="#i-cards"/></svg>Study 鰐蟹 deck · ${inDeck}</button>` : ''}
        ${addable ? `<button class="chip wk-addbtn" data-wk-act="addleeches"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg>Add all ${addable} to deck</button>` : ''}
        <span class="wk-card-badge leech">${leeches.length}</span>
      </span></div>
    <div class="wk-rows">${rows}</div>
    ${leeches.length > LIST_CAP && !expanded ? `<button class="chip wk-morebtn" data-wk-act="leechmore">Show all ${leeches.length}</button>` : ''}
  </section>`;
}

// The "show all" toggles live here beside their state; view.js routes the actions.
export function expandLeeches() { expanded = true; }
export function expandClusters() { clustersExpanded = true; }
