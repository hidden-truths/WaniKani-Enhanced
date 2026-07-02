// Shared HTML string builders for the 鰐蟹 WaniKani views — the small subject-shaped
// pieces (tiles, rows, stage seals, accuracy bars) that dashboard / leeches / browse /
// detail all compose. Pure string builders over the S maps; no DOM.
import { S } from './state.js';
import { state } from '../../state.js';
import { wkEscape, stageBand, WK_BANDS, primaryMeaning, primaryReading, leechScore } from '../../core/index.js';
import { jlptOf } from '../jlpt/data.js';

// Subject-type CSS suffix (--wk-<type> tokens): radical / kanji / vocab.
export const typeCss = (s) => (s.type === 'radical' ? 'radical' : s.type === 'kanji' ? 'kanji' : 'vocab');
export const TYPE_JP = { radical: '部', kanji: '漢', vocabulary: '語' };

// The subject's characters — or the image fallback for the few image-only radicals.
export function charHtml(s) {
  if (s.chars) return `<span class="jp">${wkEscape(s.chars)}</span>`;
  if (s.imageUrl) return `<img class="wk-radimg" src="${wkEscape(s.imageUrl)}" alt="${wkEscape(s.slug || 'radical')}">`;
  return `<span class="jp">？</span>`;
}

// One-glyph SRS stage seal (KAISATSU station stamp): 見/達/主/悟/焼, or 未 for the
// lesson queue / 鎖 locked (no assignment).
export function stageSealHtml(subjectId) {
  const a = S.assignments.get(subjectId);
  if (!a || !a.startedAt) {
    const jp = a ? '未' : '鎖';
    const label = a ? 'In lesson queue' : 'Locked';
    return `<span class="wk-seal none" title="${label}"><span class="jp">${jp}</span></span>`;
  }
  const band = stageBand(a.stage);
  const meta = WK_BANDS.find((b) => b.key === band);
  return `<span class="wk-seal ${meta.css}" title="${meta.label} (stage ${a.stage})"><span class="jp">${meta.jp}</span></span>`;
}

// Tiny meaning/reading accuracy split for a subject row (from its review stat).
export function accSplitHtml(subjectId) {
  const st = S.stats.get(subjectId);
  if (!st) return '';
  const side = (label, c, i) => {
    if (c + i === 0) return '';
    const p = Math.round((100 * c) / (c + i));
    const tone = p < 60 ? 'poor' : p < 80 ? 'mid' : 'good';
    return `<span class="wk-accpair ${tone}" title="${label}: ${c}✓ ${i}✗"><em>${label[0].toUpperCase()}</em>${p}%</span>`;
  };
  return `<span class="wk-accs">${side('meaning', st.meaningCorrect, st.meaningIncorrect)}${side('reading', st.readingCorrect, st.readingIncorrect)}</span>`;
}

// Compact clickable subject ROW (leech list, family lists). `opts.act` picks the click
// action ('open' from a view, 'jump' from inside the modal); `opts.leech` adds the 虫
// badge; `opts.score` shows the leech score chip; `opts.inDeck` marks a word already
// activated into the study deck (wk-leech-to-deck).
export function subjectRowHtml(s, opts = {}) {
  const act = opts.act || 'open';
  const st = S.stats.get(s.id);
  const score = opts.score && st ? leechScore(st) : null;
  // JLPT badge (the exam lens): vocabulary matched against the bundled word list; the
  // user's TARGET level (jlptStore.level) gets the highlighted .focus tint. Fails soft
  // to nothing before the lazy jlpt chunk loads / for unlisted words.
  const jlpt = s.type === 'vocabulary' ? jlptOf(s.chars, primaryReading(s)) : '';
  const target = (state.jlptStore || {}).level || 'N3';
  return `<button class="wk-row t-${typeCss(s)}" data-wk-act="${act}" data-id="${s.id}">
    <span class="wk-row-char">${charHtml(s)}</span>
    <span class="wk-row-main">
      <span class="wk-row-reading jp">${wkEscape(primaryReading(s))}</span>
      <span class="wk-row-meaning">${wkEscape(primaryMeaning(s))}</span>
    </span>
    ${jlpt ? `<span class="wk-jlpt${jlpt === target ? ' focus' : ''}" title="JLPT ${jlpt} vocabulary">${jlpt}</span>` : ''}
    ${opts.leech ? '<span class="wk-leech-badge" title="Leech"><span class="jp">虫</span></span>' : ''}
    ${opts.inDeck ? '<span class="wk-indeck" title="In your study deck"><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg><em>deck</em></span>' : ''}
    ${accSplitHtml(s.id)}
    ${stageSealHtml(s.id)}
    ${score != null ? `<span class="wk-score" title="Leech score">${score >= 10 ? Math.round(score) : score.toFixed(1)}</span>` : ''}
  </button>`;
}

// Small grid TILE (browse + family strips): characters over the primary meaning,
// type-coloured line on top, stage-tinted footer.
export function subjectTileHtml(s, opts = {}) {
  const act = opts.act || 'open';
  const a = S.assignments.get(s.id);
  const band = a && a.startedAt ? stageBand(a.stage) : a ? 'lesson' : 'locked';
  return `<button class="wk-tile t-${typeCss(s)} b-${band}" data-wk-act="${act}" data-id="${s.id}" title="${wkEscape(primaryMeaning(s))}">
    <span class="wk-tile-char">${charHtml(s)}</span>
    <span class="wk-tile-meaning">${wkEscape(primaryMeaning(s))}</span>
  </button>`;
}
