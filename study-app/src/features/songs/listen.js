// 歌/Songs — Listen (dictation): a per-line stepper — cloze (key content words blanked) ⇄ full-line
// (hidden, transcribe the whole line), advisory grading (the typed-reading path — practice, not SRS),
// Reveal self-check, and a per-session correct count. Line audio is the timed YouTube slice
// (playSlice), else a synth play. Renders into the stable #sgContent so a step re-render never
// re-mounts the player. Part of the features/songs/ package; shared state in ./state.js.

import { escapeHtml, plainText, segmentsToRuby, clozeBlanks, clozeLineParts, readingMatch, lineReading } from '../../core/index.js';
import { playItem } from '../audio.js';
import { playSlice } from '../songs-youtube.js';
import { S, SLOW_RATE } from './state.js';

function ensureListen() {
  if (!S.listen || S.listen.songId !== S.openSong.id) {
    // done = line indices answered all-correct → correct count = done.size (re-checking / stepping
    // back can't double-count, and Reveal never adds to it).
    S.listen = { songId: S.openSong.id, diff: 'cloze', idx: 0, done: new Set(), checked: false, revealed: false, values: [], fullValue: '' };
  }
}
export function resetListenStep() { S.listen.checked = false; S.listen.revealed = false; S.listen.values = []; S.listen.fullValue = ''; }

export function listenHtml() {
  ensureListen();
  const total = S.openSong.lines.length;
  const correct = S.listen.done.size;
  const diffChip = (id, label) => `<button class="chip${S.listen.diff === id ? ' active' : ''}" data-act="ldiff" data-diff="${id}" role="radio" aria-checked="${S.listen.diff === id}">${label}</button>`;
  const bar = `<div class="toolbar sg-listen-bar">
    <div class="sg-diff">
      <span class="filter-label">Difficulty</span>
      <div class="jlptseg" role="radiogroup" aria-label="Listen difficulty">${diffChip('cloze', 'Cloze')}${diffChip('full', 'Full line')}</div>
    </div>
    <span class="progresstxt">${S.listen.idx >= total ? `Done · ${correct} of ${total} correct` : `Line ${S.listen.idx + 1} of ${total} · ${correct} correct`}</span>
  </div>`;
  if (S.listen.idx >= total) {
    return `${bar}<div class="listen-done">
      <div class="ld-title">Session complete</div>
      <div class="ld-score">${correct} <span>/ ${total}</span></div>
      <div class="ld-sub">lines transcribed correctly this session</div>
      <button class="btn srs" data-act="lrestart"><svg class="ic" aria-hidden="true"><use href="#i-refresh"/></svg> Start over</button>
    </div>`;
  }
  return bar + listenCardHtml(S.openSong.lines[S.listen.idx]);
}

function listenCardHtml(line) {
  // The "Slower" cue only applies to the timed YouTube slice (real vocals); an untimed line plays
  // synth, which has no slow-down — so hide it there rather than show a button that does nothing.
  const slow = line.clipStartMs != null
    ? `<button class="cue-btn" data-act="lslow" aria-label="Replay slower" title="Replay slower"><svg class="ic" aria-hidden="true"><use href="#i-refresh"/></svg></button>` : '';
  const cue = `<div class="listen-cue">
    <button class="cue-btn" data-act="lplay" aria-label="Play line" title="Play line"><svg class="ic" aria-hidden="true"><use href="#i-play"/></svg></button>
    ${slow}
    <span class="cue-hint">${S.listen.diff === 'cloze' ? 'play the line, then fill the gaps' : 'lyrics hidden — type the whole line you hear'}</span>
  </div>`;
  const blanks = S.listen.diff === 'cloze' ? clozeBlanks(line) : [];
  const noGaps = S.listen.diff === 'cloze' && !blanks.length;   // a line with no content words to blank
  const bodyHtml = S.listen.diff === 'full'
    ? fullBodyHtml(line)
    : (noGaps ? `<div class="l-jp jp">${line.furigana ? segmentsToRuby(line.furigana) : escapeHtml(line.text)}</div>` : clozeBodyHtml(line, blanks));
  // Check disappears for a no-gap cloze line and once Revealed (the answer is shown → grading it would
  // just be self-marking). Reveal disappears once used. Next is always present (acts as Skip pre-answer).
  const canCheck = !noGaps && !S.listen.revealed;
  const nextLabel = (S.listen.checked || S.listen.revealed || noGaps) ? 'Next' : 'Skip';
  const actions = `<div class="listen-actions">
    ${canCheck ? `<button class="btn srs" data-act="lcheck"><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg> Check</button>` : ''}
    ${!S.listen.revealed ? `<button class="btn ghost" data-act="lreveal"><svg class="ic" aria-hidden="true"><use href="#i-eye"/></svg> Reveal</button>` : ''}
    <button class="btn ghost" data-act="lnext">${nextLabel} <svg class="ic" aria-hidden="true"><use href="#i-chevron"/></svg></button>
  </div>`;
  return `<div class="listen-card">${cue}${bodyHtml}${actions}${S.listen.revealed ? listenAnswerHtml(line) : ''}</div>`;
}

// The cloze line: visible ruby/text runs from clozeLineParts interleaved with a gap per blank. A gap
// is an <input> until Check (→ the typed value with a ✓/✕) or Reveal (→ the frozen typed value).
function clozeBodyHtml(line, blanks) {
  let gi = -1;
  const html = clozeLineParts(line, blanks).map((p) => {
    if (p.type === 'ruby') return `<ruby>${escapeHtml(p.t)}<rt>${escapeHtml(p.r)}</rt></ruby>`;
    if (p.type === 'text') return escapeHtml(p.t);
    gi += 1;
    const val = S.listen.values[gi] || '';
    if (S.listen.checked) {
      const ok = readingMatch(val, p.reading || p.surface);
      return `<span class="gap-res ${ok ? 'ok' : 'bad'}">${escapeHtml(val || '⋯')}<span class="gap-mark">${ok ? '✓' : '✕'}</span></span>`;
    }
    if (S.listen.revealed) return `<span class="gap-res neutral">${escapeHtml(val || '⋯')}</span>`;
    return `<input class="gap-inp jp" data-gi="${gi}" value="${escapeHtml(val)}" aria-label="Fill the missing word" autocomplete="off" autocapitalize="off" spellcheck="false">`;
  }).join('');
  return `<div class="l-jp jp listen-cloze">${html}</div>`;
}

// Full-line: one input for the whole line's reading. After Check it freezes with a ✓/✕ verdict.
function fullBodyHtml(line) {
  if (S.listen.checked) {
    const ok = readingMatch(S.listen.fullValue, lineReading(line));
    return `<div class="listen-full"><input class="inp jp listen-full-inp ${ok ? 'ok' : 'bad'}" value="${escapeHtml(S.listen.fullValue)}" readonly>
      <span class="listen-verdict ${ok ? 'ok' : 'bad'}">${ok ? '✓ matches' : '✕ not quite'}</span></div>`;
  }
  return `<div class="listen-full"><input class="inp jp listen-full-inp" value="${escapeHtml(S.listen.fullValue)}" placeholder="type the reading you hear" autocomplete="off" autocapitalize="off" spellcheck="false"${S.listen.revealed ? ' readonly' : ''}></div>`;
}

function listenAnswerHtml(line) {
  return `<div class="listen-answer">
    <div class="cmp-label">Revealed answer</div>
    <div class="l-jp jp">${line.furigana ? segmentsToRuby(line.furigana) : escapeHtml(line.text)}</div>
    ${line.en ? `<div class="l-en">${escapeHtml(line.en)}</div>` : ''}
  </div>`;
}

// Re-render ONLY the Listen stepper (the #sgContent wrapper), leaving the mounted YouTube player be.
export function renderListen() { const c = document.getElementById('sgContent'); if (c) c.innerHTML = listenHtml(); }

// Pull the current step's typed value(s) out of the DOM before a re-render (the same capture-before-
// render dance runAnalyze uses for the lyrics textarea).
export function captureListenInputs() {
  if (!S.listen) return;
  if (S.listen.diff === 'cloze') {
    const inps = [...document.querySelectorAll('#sgBody .gap-inp')];
    if (inps.length) S.listen.values = inps.map((el) => el.value);
  } else {
    const el = document.querySelector('#sgBody .listen-full-inp');
    if (el) S.listen.fullValue = el.value;
  }
}
// Advisory-grade the current step; mark the line done (counts once) iff every gap / the full line matches.
export function gradeListen() {
  const line = S.openSong.lines[S.listen.idx]; if (!line) return;
  let ok;
  if (S.listen.diff === 'cloze') {
    const blanks = clozeBlanks(line);
    if (!blanks.length) return;   // no-gap line — not gradable (Check isn't shown for it)
    ok = blanks.every((b, i) => readingMatch(S.listen.values[i] || '', b.reading || b.surface));
  } else {
    ok = readingMatch(S.listen.fullValue, lineReading(line));
  }
  if (ok) S.listen.done.add(S.listen.idx);
}
// Play the current line: the timed YouTube slice ([start, next-start], optionally slowed), else synth.
export function playListenLine(slow, btn) {
  const line = S.openSong.lines[S.listen.idx]; if (!line) return;
  const next = S.openSong.lines[S.listen.idx + 1];
  if (line.clipStartMs != null
    && playSlice(line.clipStartMs / 1000, next && next.clipStartMs != null ? next.clipStartMs / 1000 : undefined, slow ? SLOW_RATE : 1)) return;
  playItem({ text: plainText(line.text) }, 'songs', btn);   // synth fallback (slow not available for synth)
}
