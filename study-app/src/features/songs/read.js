// 歌/Songs — Read mode: the lyric viewer (tap-a-word ruby, per-line star + replay, stanza headings),
// the YouTube player mount + synced-line highlight, and per-line replay. Part of the features/songs/
// package; shared mutable state in ./state.js. See REFACTOR_FOLLOWUPS.md "Workstream S".

import { escapeHtml, plainText, segmentsToRuby, overlayTokens } from '../../core/index.js';
import { grammarLabel } from '../../data/grammar.js';
import { playItem, cycleMod } from '../audio.js';
import { mountPlayer, playSlice } from '../songs-youtube.js';
import { S } from './state.js';
import { progressFor } from './progress.js';

// A per-line star toggle (a bookmark; shown in Read). `.on` = starred. Wired by the 'star' onClick act.
function starBtnHtml(ord, on) {
  return `<button class="speak-btn sm sg-star${on ? ' on' : ''}" data-act="star" data-ord="${ord}" aria-pressed="${on}" aria-label="${on ? 'Unstar line' : 'Star line'}" title="Star this line"><svg class="ic" aria-hidden="true"><use href="#i-star"/></svg></button>`;
}

export function readHtml() {
  const s = S.openSong;
  const starred = new Set((progressFor(s.id) || {}).starred || []);   // per-line bookmarks (the `songs` blob)
  const ttoolbar = `<div class="ttoolbar">
    <button class="tgl on" data-act="furigana"><svg class="ic" aria-hidden="true"><use href="#i-eye"/></svg> Furigana</button>
    <button class="tgl" data-act="reveal-all"><svg class="ic" aria-hidden="true"><use href="#i-eyeoff"/></svg> Translations · on tap</button>
  </div>`;
  const lines = s.lines.map((l, i) => {
    const jp = l.tokens && l.tokens.length && l.furigana
      ? overlayTokens(l.furigana, l.tokens)
      : (l.furigana ? segmentsToRuby(l.furigana) : escapeHtml(l.text));
    const gram = (l.grammar || []).map((g) => `<span class="ex-gram-chip" data-act="grammar" data-g="${escapeHtml(g)}" role="button" tabindex="0">${escapeHtml(grammarLabel(g))}</span>`).join('');
    const en = l.en || '';
    const enRow = en
      ? `<div class="l-en hidden" data-act="reveal" data-en="${escapeHtml(en)}"><svg class="ic" aria-hidden="true"><use href="#i-eye"/></svg> tap to reveal translation</div>` : '';
    // A stanza label (set on the first line of each stanza) heads the group + opens the spacing.
    const head = l.section ? `<div class="stanza-label">${escapeHtml(l.section)}</div>` : '';
    return `${head}<div class="lyric${l.section ? ' stanza-start' : ''}" data-ord="${i}">
      <div class="l-top">
        <div class="l-jp jp">${jp}</div>
        <div class="l-ctl">${starBtnHtml(i, starred.has(i))}<button class="speak-btn sm" data-act="replay" data-ord="${i}" aria-label="Replay line" title="Replay line"><svg class="ic" aria-hidden="true"><use href="#i-play"/></svg></button></div>
      </div>
      ${gram ? `<div class="gram-row">${gram}</div>` : ''}
      ${enRow}
    </div>`;
  }).join('');
  return `${ttoolbar}<div class="lyrics">${lines}</div>`;
}

// Local furigana toggle for Read (independent of the global setting): flip <rt> visibility on the
// lyric block. Uses the global data-furigana attribute scoped here via a class on the lyrics list.
export function toggleFurigana(btn) {
  const lyr = document.querySelector('#sgBody .lyrics');
  if (lyr) lyr.classList.toggle('furi-off');
  btn.classList.toggle('on');
}

// ---- the YouTube player mount + synced highlight ----
export function mountSongPlayer() {
  if (!S.openSong || !S.openSong.youtubeId) return;
  const el = document.getElementById('sgPlayer'); if (!el) return;
  mountPlayer(el, S.openSong.youtubeId, { onTime: highlightAt });
}
function highlightAt(sec) {
  if (!S.openSong || S.mode !== 'read') return;
  const ms = sec * 1000;
  let cur = -1;
  S.openSong.lines.forEach((l, i) => { if (l.clipStartMs != null && l.clipStartMs <= ms) cur = i; });
  document.querySelectorAll('#sgBody .lyric').forEach((el, i) => { el.classList.toggle('cur', i === cur); el.classList.toggle('past', i < cur); });
}

// ---- per-line replay: a timed YouTube slice, else a synth play of the line ----
export function replayLine(ord, btn, e) {
  const l = S.openSong.lines[ord]; if (!l) return;
  const next = S.openSong.lines[ord + 1];
  if (l.clipStartMs != null && playSlice(l.clipStartMs / 1000, next && next.clipStartMs != null ? next.clipStartMs / 1000 : undefined)) return;
  playItem({ text: plainText(l.text) }, 'songs', btn, { cycle: cycleMod(e) });
}
