// 苦手 Leeches view — the reason this tab exists. Two sections: same-kanji CONFUSION
// GROUPS (a leech vocab shown beside every other started word using the same kanji —
// the "same kanji, slightly different meaning" trap laid out side-by-side), then the
// full ranked leech list. Scoring/clustering is pure core (buildLeeches /
// confusionClusters); this module renders.
import { S } from './state.js';
import { buildLeeches, confusionClusters, wkEscape, primaryMeaning, primaryReading } from '../../core/index.js';
import { subjectRowHtml, charHtml } from './bits.js';

const LIST_CAP = 60;

// The current leech ranking (worst-first). Recomputed per render — 3.5k stats is
// sub-millisecond, no caching needed.
export function leechList() {
  if (!S.loaded) return [];
  return buildLeeches([...S.stats.values()], S.assignments, S.subjects);
}

export function leechesHtml() {
  const leeches = leechList();
  if (!leeches.length) {
    return `<section class="wk-card"><div class="wk-empty">No leeches right now — every wobbly item has recovered its streak. 完璧です。</div></section>`;
  }
  const clusters = confusionClusters(leeches, S.subjects, S.assignments);
  return clustersHtml(clusters) + listHtml(leeches);
}

/* ---- confusion groups ---------------------------------------------------------- */

function clustersHtml(clusters) {
  if (!clusters.length) return '';
  const cards = clusters.slice(0, 12).map((c) => {
    const k = c.kanji;
    const members = c.members.map((m) => subjectRowHtml(m.subject, { leech: m.isLeech })).join('');
    return `<div class="wk-cluster">
      <button class="wk-cluster-kanji" data-wk-act="open" data-id="${k.id}" title="${wkEscape(primaryMeaning(k))}">
        <span class="wk-cluster-char">${charHtml(k)}</span>
        <span class="wk-cluster-info"><b>${wkEscape(primaryMeaning(k))}</b><span class="jp">${wkEscape(primaryReading(k))}</span></span>
      </button>
      <div class="wk-cluster-members">${members}</div>
    </div>`;
  }).join('');
  return `<section class="wk-card wk-clusters-card">
    <div class="wk-card-head"><div><h2 class="title"><span class="jp-min">混同注意</span> · Same-kanji confusion</h2>
      <div class="sub">each leech beside every word you know that shares its kanji — read the family together, the differences stick</div></div>
      <span class="wk-card-badge leech">${clusters.length} group${clusters.length === 1 ? '' : 's'}</span></div>
    <div class="wk-clusters">${cards}</div>
  </section>`;
}

/* ---- full ranked list ------------------------------------------------------------ */

let expanded = false;
export function resetLeechExpand() { expanded = false; }

function listHtml(leeches) {
  const shown = expanded ? leeches : leeches.slice(0, LIST_CAP);
  const rows = shown.map((l) => subjectRowHtml(l.subject, { leech: false, score: true })).join('');
  return `<section class="wk-card">
    <div class="wk-card-head"><div><h2 class="title">All leeches</h2>
      <div class="sub">score = misses ÷ current streak<sup>1.5</sup>, worse side of meaning/reading · tap for mnemonics & family</div></div>
      <span class="wk-card-badge leech">${leeches.length}</span></div>
    <div class="wk-rows">${rows}</div>
    ${leeches.length > LIST_CAP && !expanded ? `<button class="chip wk-morebtn" data-wk-act="leechmore">Show all ${leeches.length}</button>` : ''}
  </section>`;
}

// The "show all" toggle lives here beside its state; view.js routes the action.
export function expandLeeches() { expanded = true; }
