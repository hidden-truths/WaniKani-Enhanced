// 歌/Songs — Read mode: the lyric viewer (tap-a-word ruby, per-line star + replay, stanza headings),
// the YouTube player mount + synced-line highlight, and per-line replay. Part of the features/songs/
// package; shared mutable state in ./state.js. (Workstream S — the refactor record is in ROADMAP.html).

import { escapeHtml, plainText, segmentsToRuby, overlayTokens } from '../../core/index.js';
import { grammarLabel } from '../../data/grammar.js';
import { playItem, cycleMod } from '../audio.js';
import { mountPlayer, playSlice } from '../songs-youtube.js';
import { S } from './state.js';
import { progressFor } from './progress.js';
import { render } from './index.js';

// Render the Read viewer (the mock's lyric STAGE): a stage label + one .ll row per line — line
// number, tap-a-word ruby, tap-to-reveal translation, grammar pills, and the per-line tool cluster
// (▶ this line · save-to-Self-talk · star). The .ll.current row is the glowing playhead (synced by
// highlightAt while the video plays). The furigana toggle lives in the hero (see songHtml).
export function readHtml() {
  const s = S.openSong;
  const starred = new Set((progressFor(s.id) || {}).starred || []);   // per-line bookmarks (the `songs` blob)
  const n = s.lines.length;
  const lines = s.lines.map((l, i) => {
    const jp = l.tokens && l.tokens.length && l.furigana
      ? overlayTokens(l.furigana, l.tokens)
      : (l.furigana ? segmentsToRuby(l.furigana) : escapeHtml(l.text));
    const gram = (l.grammar || []).map((g) => `<span class="gpill" data-act="grammar" data-g="${escapeHtml(g)}" role="button" tabindex="0">${escapeHtml(grammarLabel(g))}</span>`).join('');
    const en = l.en || '';
    const enRow = en
      ? `<p class="en hidden" data-act="reveal" data-en="${escapeHtml(en)}"><svg class="ic" aria-hidden="true"><use href="#i-eye"/></svg> tap to reveal translation</p>` : '';
    const on = starred.has(i);
    const tools = `<div class="ll-tools">
      <button class="lt" data-act="replay" data-ord="${i}" title="Play this line"><svg class="ic" aria-hidden="true"><use href="#i-play"/></svg> this line</button>
      <button class="lt" data-act="savephrase" data-ord="${i}" title="Save to 独り言 Self-talk"><svg class="ic" aria-hidden="true"><use href="#i-mic"/></svg> Save to Self-talk</button>
      <button class="lt sg-star${on ? ' starred' : ''}" data-act="star" data-ord="${i}" aria-pressed="${on}" title="${on ? 'Unstar line' : 'Star line'}"><svg class="ic" aria-hidden="true"><use href="#i-star"/></svg> ${on ? 'Starred' : 'Star'}</button>
    </div>`;
    // A stanza label (set on the first line of each stanza) heads the group + opens the spacing.
    const head = l.section ? `<div class="stanza-label">${escapeHtml(l.section)}</div>` : '';
    return `${head}<div class="ll${l.section ? ' stanza-start' : ''}" data-ord="${i}">
      <span class="num">${String(i + 1).padStart(2, '0')}</span>
      <span class="now-tag"><span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span> Now playing</span>
      <p class="jp">${jp}</p>
      ${enRow}
      ${gram ? `<div class="gram-row">${gram}</div>` : ''}
      ${tools}
    </div>`;
  }).join('');
  return `<div class="stage-label">Lyrics <span class="line-rule"></span> <span class="count">${n} line${n === 1 ? '' : 's'} · tap a word to look it up</span>
    <button class="sg-revealall" data-act="reveal-all" title="Reveal every translation"><svg class="ic" aria-hidden="true"><use href="#i-eye"/></svg> Show all</button></div>
    <div class="lyric-list lyrics">${lines}</div>`;
}

// Local furigana toggle for Read (independent of the global setting): flip <rt> visibility on the
// lyric list. Uses the global data-furigana attribute scoped here via a class on the list.
export function toggleFurigana(btn) {
  const lyr = document.querySelector('#sgBody .lyric-list');
  if (lyr) lyr.classList.toggle('furi-off');
  const on = !btn.classList.contains('on');   // .fg-toggle reflects state via .on + aria-pressed
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
}

// ---- the YouTube player mount + synced highlight ----
export async function mountSongPlayer() {
  if (!S.openSong || !S.openSong.youtubeId) return;
  const el = document.getElementById('sgPlayer'); if (!el) return;
  // Read mounts the player only after "Play with video" (S.videoOn) → autoplay from that user gesture;
  // Listen/Shadow mount it to drive masked-audio / slices, without autoplay.
  const player = await mountPlayer(el, S.openSong.youtubeId, { onTime: highlightAt, autoplay: S.mode === 'read' && S.videoOn });
  // API failed to load / mount (offline, blocked, CSP): don't leave a dead "Play with video" button
  // over an empty iframe. Flag it + re-render so the hero shows a "Video unavailable" note and the
  // bay is hidden (per-line replay already falls back to synth). Sticky for this song; the re-render
  // hides #sgPlayer so this can't loop.
  if (!player && !S.videoFailed) { S.videoFailed = true; render(); }
}
function highlightAt(sec) {
  if (!S.openSong || S.mode !== 'read') return;
  const ms = sec * 1000;
  let cur = -1;
  S.openSong.lines.forEach((l, i) => { if (l.clipStartMs != null && l.clipStartMs <= ms) cur = i; });
  document.querySelectorAll('#sgBody .lyric-list .ll').forEach((el, i) => { el.classList.toggle('current', i === cur); el.classList.toggle('past', i < cur); });
}

// ---- per-line replay: a timed YouTube slice, else a synth play of the line ----
export function replayLine(ord, btn, e) {
  const l = S.openSong.lines[ord]; if (!l) return;
  const next = S.openSong.lines[ord + 1];
  if (l.clipStartMs != null && playSlice(l.clipStartMs / 1000, next && next.clipStartMs != null ? next.clipStartMs / 1000 : undefined)) return;
  playItem({ text: plainText(l.text) }, 'songs', btn, { cycle: cycleMod(e) });
}
