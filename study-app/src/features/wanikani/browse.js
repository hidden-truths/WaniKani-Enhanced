// 一覧 Browse view — the whole 9.4k-subject corpus, level by level. Default scope is
// ONE level (the user's current); searching widens to everything. Type + stage-band
// chips AND together (the app's facet feel, without the deck's wireFacets machinery —
// these are S.browse view-state, not a study filter). Renders capped with "show more"
// so a broad filter can't paint thousands of tiles at once.
import { S } from './state.js';
import { stageBand, subjectMatches, wkEscape } from '../../core/index.js';
import { subjectTileHtml, TYPE_JP } from './bits.js';

const TYPES = [
  { key: 'radical', jp: TYPE_JP.radical, label: 'Radicals' },
  { key: 'kanji', jp: TYPE_JP.kanji, label: 'Kanji' },
  { key: 'vocabulary', jp: TYPE_JP.vocabulary, label: 'Vocabulary' },
];
const BANDS = [
  { key: 'locked', jp: '鎖', label: 'Locked' },
  { key: 'lesson', jp: '未', label: 'Lesson queue' },
  { key: 'apprentice', jp: '見', label: 'Apprentice' },
  { key: 'guru', jp: '達', label: 'Guru' },
  { key: 'master', jp: '主', label: 'Master' },
  { key: 'enlightened', jp: '悟', label: 'Enlightened' },
  { key: 'burned', jp: '焼', label: 'Burned' },
];

const bandOf = (s) => {
  const a = S.assignments.get(s.id);
  if (!a) return 'locked';
  if (!a.startedAt) return 'lesson';
  return stageBand(a.stage);
};

function filtered() {
  const level = S.browse.level ?? ((S.user && S.user.level) || 1);
  const q = S.browse.q;
  const out = [];
  for (const s of S.subjects.values()) {
    if (s.hidden) continue;
    if (q ? !subjectMatches(s, q) : s.level !== level) continue;   // search = global; no search = one level
    if (S.browse.types.length && !S.browse.types.includes(s.type)) continue;
    if (S.browse.bands.length && !S.browse.bands.includes(bandOf(s))) continue;
    out.push(s);
  }
  const typeOrder = { radical: 0, kanji: 1, vocabulary: 2 };
  return out.sort((a, b) => (a.level - b.level) || (typeOrder[a.type] - typeOrder[b.type]) || a.id - b.id);
}

export function browseHtml() {
  const level = S.browse.level ?? ((S.user && S.user.level) || 1);
  const typeChips = TYPES.map((t) => `<button class="wk-minichip t-${t.key === 'vocabulary' ? 'vocab' : t.key}${S.browse.types.includes(t.key) ? ' active' : ''}" data-wk-act="btype" data-type="${t.key}"><span class="jp">${t.jp}</span> ${t.label}</button>`).join('');
  const bandChips = BANDS.map((b) => `<button class="wk-minichip${S.browse.bands.includes(b.key) ? ' active' : ''}" data-wk-act="bband" data-band="${b.key}" title="${b.label}"><span class="jp">${b.jp}</span></button>`).join('');
  return `<section class="wk-card wk-browse">
    <div class="wk-browse-controls">
      <span class="wk-levelstep" role="group" aria-label="Level">
        <button class="tool-btn" data-wk-act="blevel" data-step="-1" aria-label="Previous level">−</button>
        <span class="wk-levelnum">Level <b>${level}</b></span>
        <button class="tool-btn" data-wk-act="blevel" data-step="1" aria-label="Next level">＋</button>
      </span>
      <span class="wk-browse-chips">${typeChips}</span>
      <span class="wk-browse-chips wk-bandchips" aria-label="SRS stage">${bandChips}</span>
      <span class="search-wrap wk-searchwrap"><svg class="ic" aria-hidden="true"><use href="#i-search"/></svg>
        <input class="search" id="wkSearch" placeholder="Search all levels — kanji, reading, or meaning…" value="${wkEscape(S.browse.q)}"></span>
    </div>
    ${browseResultsHtml()}
  </section>`;
}

// The results grid alone — swapped in place on search keystrokes so the input never
// loses focus to a full re-render.
export function browseResultsHtml() {
  const rows = filtered();
  const shown = rows.slice(0, S.browseCap);
  const grid = shown.map((s) => subjectTileHtml(s)).join('');
  return `<div id="wkBrowseResults">
    <div class="wk-browse-count">${rows.length.toLocaleString()} item${rows.length === 1 ? '' : 's'}${S.browse.q ? ' · all levels' : ''}</div>
    ${rows.length ? `<div class="wk-grid">${grid}</div>` : '<div class="wk-empty">Nothing matches that filter.</div>'}
    ${rows.length > shown.length ? `<button class="chip wk-morebtn" data-wk-act="showmore">Show ${Math.min(400, rows.length - shown.length)} more</button>` : ''}
  </div>`;
}
