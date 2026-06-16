// 歌/Songs — Shadow (record & compare): per-line speaking practice reusing the record-and-compare
// engine VERBATIM (the same rig Minna + Self-Talk feed) with the reserved SONGS_SCOPE + per-line
// itemKey. Reference tiers: TTS (synth — decodable → the full rig: ▶you/▶ref/→you/both/loop + dual
// waveforms) AND, for TIMED lines, a by-ear "▶ original" YouTube slice (the iframe's audio can't be
// decoded → no waveform/overlay, by design). Part of the features/songs/ package; state in ./state.js.

import { account } from '../cloud-core.js';
import { escapeHtml, plainText, segmentsToRuby, songLineKey } from '../../core/index.js';
import { playSlice } from '../songs-youtube.js';
import {
  RECORD_SUPPORTED, enterSpeakingMode, exitSpeakingMode, isSpeakingMode,
  speakingBarHtml, initMicSelector, wireSpeakingControls,
  recordControlHtml, wireRecordCompare, paintCompareWaveforms, loadRecordings,
} from '../record-compare.js';
import { S, SONGS_SCOPE, body } from './state.js';

export function shadowHtml() {
  const s = S.openSong;
  const speaking = isSpeakingMode();
  let intro;
  if (!account) {
    intro = `<div class="signup-banner sg-gate" style="margin:8px 0 14px"><svg class="ic" style="font-size:22px" aria-hidden="true"><use href="#i-mic"/></svg>
      <div class="sb-text"><b>Sign in to shadow.</b> Recording your voice + comparing it to a reference needs an account. Reading + listening work without one.</div>
      <button class="btn srs" data-act="signin">Sign in</button></div>`;
  } else if (!RECORD_SUPPORTED) {
    intro = `<p class="add-note" style="margin:6px 0 12px"><svg class="ic" aria-hidden="true"><use href="#i-alert"/></svg> Recording needs a modern browser with a microphone.</p>`;
  } else {
    intro = speaking
      ? `<p class="add-note" style="margin:6px 0 12px"><svg class="ic" aria-hidden="true"><use href="#i-mic"/></svg> Record each line, then compare to the reference voice. Tap <b>▶ original</b> to hear the real performance (timed lines).</p>`
      : `<p class="add-note" style="margin:6px 0 12px"><svg class="ic" aria-hidden="true"><use href="#i-mic"/></svg> Turn on <b>Practice speaking</b> in the bar above to record yourself line by line.</p>`;
  }
  const lines = s.lines.map((l, i) => {
    const jp = l.furigana ? segmentsToRuby(l.furigana) : escapeHtml(l.text);
    // The by-ear "▶ original" YouTube slice — timed lines only (untimed → the TTS reference covers it).
    const orig = l.clipStartMs != null
      ? `<button class="speak-btn sm" data-act="shadowslice" data-ord="${i}" title="Play the original (by ear)" aria-label="Play the original line"><svg class="ic" aria-hidden="true"><use href="#i-play"/></svg></button>` : '';
    // The full record-and-compare rig (synth reference via the 'songs' audio context) — speaking + signed in.
    const rec = (speaking && account)
      ? recordControlHtml(SONGS_SCOPE, songLineKey(s.id, i), '', null, false, plainText(l.text), 'songs') : '';
    return `<div class="lyric shadow-line" data-ord="${i}">
      <div class="l-top"><div class="l-jp jp">${jp}</div><div class="l-ctl">${orig}</div></div>
      ${l.en ? `<div class="l-en">${escapeHtml(l.en)}</div>` : ''}
      ${rec}
    </div>`;
  }).join('');
  return `${intro}<div class="lyrics">${lines}</div>`;
}

// Attach the record-compare delegates (once, on the persistent #sgBody) + paint the waveforms.
export function wireShadow(el) {
  wireRecordCompare(el);
  if (isSpeakingMode()) paintCompareWaveforms(el);
}
// Re-render ONLY the Shadow body (the stable #sgContent — leaves the player mounted), re-wiring the
// engine + repainting waveforms. Used on the speaking toggle (controls appear/vanish).
export function renderShadow() {
  const c = document.getElementById('sgContent'); if (!c) return;
  c.innerHTML = shadowHtml();
  const el = body(); if (el) wireShadow(el);
}

// The navbar-docked speaking bar (toggle + mic picker + speed + you⟷ref balance), in #navExtra —
// only while viewing a song in Shadow + signed in (otherwise the slot is cleared).
export function songNav() {
  const nav = document.getElementById('navExtra'); if (!nav) return;
  if (S.view !== 'song' || S.mode !== 'shadow' || !RECORD_SUPPORTED || !account) { nav.innerHTML = ''; return; }
  nav.innerHTML = speakingBarHtml();
  wireSpeakingControls(nav);   // speed chips + bias slider (attach-once on the slot; shared with Minna/Self-Talk)
  const tog = nav.querySelector('[data-speaking-toggle]');
  if (tog) tog.addEventListener('click', async () => {
    if (isSpeakingMode()) { exitSpeakingMode(); renderShadow(); songNav(); return; }
    if (!(await enterSpeakingMode())) return;
    if (!S.recordingsLoaded) { await loadRecordings(SONGS_SCOPE); S.recordingsLoaded = true; }
    renderShadow(); songNav();   // re-render so the per-line record controls appear + the bar updates
  });
  initMicSelector(nav, () => { if (isSpeakingMode()) enterSpeakingMode(); });
}
export function clearNavSpeaking() { const nav = document.getElementById('navExtra'); if (nav) nav.innerHTML = ''; }

// The by-ear YouTube slice for a timed line (Shadow's "▶ original"); no-op if untimed / no player.
export function playShadowSlice(ord) {
  const l = S.openSong.lines[ord]; if (!l || l.clipStartMs == null) return;
  const next = S.openSong.lines[ord + 1];
  playSlice(l.clipStartMs / 1000, next && next.clipStartMs != null ? next.clipStartMs / 1000 : undefined);
}
