// Subject detail modal — the deep-dive card behind every tile/row: the full WK study
// surface (meanings, readings, mnemonics + hints, context sentences) plus YOUR record
// (stage, next review, accuracy, streaks) and the relation strips (components, the
// same-kanji family, visually similar). Family entries navigate IN the modal
// (data-wk-act="jump", breadcrumb back), so a confusion pair can be flipped between
// without losing your place.
import { S } from './state.js';
import {
  wkEscape, renderWkMarkup, stageBand, WK_BANDS, timeUntil, leechScore,
} from '../../core/index.js';
import { charHtml, typeCss, subjectRowHtml, TYPE_JP } from './bits.js';

export function detailHtml(id) {
  const s = S.subjects.get(id);
  if (!s) return '<div class="wk-empty">Subject not found in the local cache — try a refresh.</div>';
  return headerHtml(s)
    + recordHtml(s)
    + factsHtml(s)
    + mnemonicsHtml(s)
    + sentencesHtml(s)
    + familyHtml(s);
}

/* ---- header -------------------------------------------------------------------- */

function headerHtml(s) {
  const primary = (s.meanings.find((m) => m.primary) || s.meanings[0] || { m: '' }).m;
  const alts = s.meanings.filter((m) => !m.primary).map((m) => m.m).concat(s.auxMeanings || []);
  const typeLabel = s.type === 'radical' ? 'Radical' : s.type === 'kanji' ? 'Kanji' : (s.kana ? 'Kana vocabulary' : 'Vocabulary');
  const readings = s.readings.length ? `<div class="wk-d-readings">${s.readings.map((r) =>
    `<span class="wk-d-reading${r.primary ? ' primary' : ''}${r.accepted === false ? ' na' : ''}"><span class="jp">${wkEscape(r.r)}</span>${r.type ? `<em>${r.type === 'onyomi' ? '音' : r.type === 'kunyomi' ? '訓' : '名'}</em>` : ''}</span>`).join('')}</div>` : '';
  return `<div class="wk-d-head t-${typeCss(s)}">
    <div class="wk-d-char">${charHtml(s)}</div>
    <div class="wk-d-id">
      <div class="wk-d-kicker">${S.detailStack.length ? '<button class="tool-btn wk-d-back" data-wk-act="back" aria-label="Back" title="Back"><svg class="ic" aria-hidden="true"><use href="#i-back"/></svg></button>' : ''}<span class="wk-d-type"><span class="jp">${TYPE_JP[s.type]}</span> ${typeLabel}</span><span class="wk-d-level">Level ${s.level}</span>
        ${s.audio ? `<button class="play-btn wk-d-audio" data-wk-act="audio" data-url="${wkEscape(s.audio)}" aria-label="Play pronunciation" title="Play pronunciation"><svg class="ic" aria-hidden="true"><use href="#i-play"/></svg></button>` : ''}
        <a class="tool-btn wk-d-ext" href="${wkEscape(s.docUrl || '#')}" target="_blank" rel="noopener" title="Open on wanikani.com" aria-label="Open on wanikani.com"><svg class="ic" aria-hidden="true"><use href="#i-external"/></svg></a>
      </div>
      <div class="wk-d-meaning">${wkEscape(primary)}</div>
      ${alts.length ? `<div class="wk-d-alts">${alts.map(wkEscape).join(' · ')}</div>` : ''}
      ${readings}
    </div>
  </div>`;
}

/* ---- your record ----------------------------------------------------------------- */

function recordHtml(s) {
  const a = S.assignments.get(s.id);
  const st = S.stats.get(s.id);
  if (!a) return `<div class="wk-d-record"><span class="wk-d-stage none"><span class="jp">鎖</span> Locked</span><span class="wk-d-rec-note">not unlocked yet</span></div>`;
  const band = a.startedAt ? stageBand(a.stage) : 'lesson';
  const meta = WK_BANDS.find((b) => b.key === band);
  const stageChip = meta
    ? `<span class="wk-d-stage ${meta.css}"><span class="jp">${meta.jp}</span> ${meta.label} · ${a.stage}</span>`
    : `<span class="wk-d-stage none"><span class="jp">未</span> Lesson queue</span>`;
  const next = a.burnedAt ? 'burned ' + new Date(a.burnedAt).toLocaleDateString()
    : a.availableAt ? 'next review ' + timeUntil(a.availableAt, Date.now()) : '';
  const side = (label, c, i, cs, ms) => (c + i) === 0 ? '' : `
    <div class="wk-d-acc">
      <span class="wk-d-acc-label">${label}</span>
      <span class="wk-acctrack"><span class="wk-accfill" style="width:${Math.round((100 * c) / (c + i))}%"></span></span>
      <b>${Math.round((100 * c) / (c + i))}%</b>
      <span class="wk-d-streak" title="current / best streak">${cs}▲ ${ms}★</span>
      <span class="wk-d-misses">${i}✗</span>
    </div>`;
  const score = st ? leechScore(st) : 0;
  return `<div class="wk-d-record">
    ${stageChip}
    ${next ? `<span class="wk-d-rec-note">${next}</span>` : ''}
    ${score >= 1 ? `<span class="wk-leech-badge big" title="Leech score ${score.toFixed(1)}"><span class="jp">虫</span> leech ${score >= 10 ? Math.round(score) : score.toFixed(1)}</span>` : ''}
    ${st ? `<div class="wk-d-accs">
      ${side('Meaning', st.meaningCorrect, st.meaningIncorrect, st.meaningCurrentStreak, st.meaningMaxStreak)}
      ${side('Reading', st.readingCorrect, st.readingIncorrect, st.readingCurrentStreak, st.readingMaxStreak)}
    </div>` : ''}
  </div>`;
}

/* ---- facts (part of speech) --------------------------------------------------------- */

function factsHtml(s) {
  if (!s.pos || !s.pos.length) return '';
  return `<div class="wk-d-pos">${s.pos.map((p) => `<span class="wk-d-postag">${wkEscape(p)}</span>`).join('')}</div>`;
}

/* ---- mnemonics ------------------------------------------------------------------------ */

function mnemonicsHtml(s) {
  const block = (title, text, hint) => !text ? '' : `
    <div class="wk-d-mnem">
      <div class="wk-d-mnem-title">${title}</div>
      <div class="wk-d-mnem-body">${renderWkMarkup(text)}</div>
      ${hint ? `<details class="wk-d-hint"><summary>hint</summary><div>${renderWkMarkup(hint)}</div></details>` : ''}
    </div>`;
  const html = block('Meaning mnemonic', s.meaningMnemonic, s.meaningHint)
    + block('Reading mnemonic', s.readingMnemonic, s.readingHint);
  return html ? `<div class="wk-d-section">${html}</div>` : '';
}

/* ---- context sentences ------------------------------------------------------------------ */

function sentencesHtml(s) {
  if (!s.contextSentences || !s.contextSentences.length) return '';
  const rows = s.contextSentences.map((cs) => `
    <div class="wk-d-sentence"><div class="jp">${wkEscape(cs.ja)}</div><div class="wk-d-sen-en">${wkEscape(cs.en)}</div></div>`).join('');
  return `<div class="wk-d-section"><div class="wk-d-sec-title">Context sentences</div>${rows}</div>`;
}

/* ---- relation strips ---------------------------------------------------------------------- */

function familyHtml(s) {
  const rowsFor = (ids, { leechMark = true } = {}) => ids
    .map((id) => S.subjects.get(id)).filter((x) => x && !x.hidden)
    .map((x) => {
      const st = S.stats.get(x.id);
      const isLeech = leechMark && st && leechScore(st) >= 1;
      return subjectRowHtml(x, { act: 'jump', leech: isLeech });
    }).join('');

  let html = '';
  if (s.componentIds && s.componentIds.length) {
    html += section(s.type === 'vocabulary' ? 'Made of these kanji' : 'Made of these radicals', rowsFor(s.componentIds));
  }
  if (s.amalgamationIds && s.amalgamationIds.length) {
    html += section(s.type === 'kanji' ? 'Same-kanji family — words using ' + wkEscape(s.chars || s.slug) : 'Used in', rowsFor(s.amalgamationIds));
  }
  if (s.type === 'vocabulary' && s.componentIds && s.componentIds.length) {
    // the confusion helper: the OTHER vocab sharing each component kanji
    for (const kid of s.componentIds) {
      const k = S.subjects.get(kid);
      if (!k || k.type !== 'kanji' || !k.amalgamationIds) continue;
      const sibs = k.amalgamationIds.filter((id) => id !== s.id && S.assignments.has(id));
      if (!sibs.length) continue;
      html += section(`Siblings of <span class="jp">${wkEscape(k.chars || '')}</span> you've met`, rowsFor(sibs));
    }
  }
  if (s.similarIds && s.similarIds.length) {
    html += section('Visually similar', rowsFor(s.similarIds));
  }
  return html;
}

const section = (title, rows) => !rows ? '' : `
  <div class="wk-d-section"><div class="wk-d-sec-title">${title}</div><div class="wk-rows">${rows}</div></div>`;
