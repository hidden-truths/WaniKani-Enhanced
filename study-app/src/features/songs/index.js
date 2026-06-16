// 歌 / Songs — package orchestrator. Owns the top-level render dispatch (library / add / song-view),
// the song-view shell (mode switch + player + the stable #sgContent wrapper), the once-attached
// delegated click/keydown, navigation (openById), and the lifecycle (initSongs/onSongsHidden). Each
// MODE + surface lives in its own sibling module behind this barrel; shared mutable view-state is the
// `S` object in ./state.js (mutated in place — the record-compare pattern). features/songs.js is a
// thin re-export of this file, so main.js + cloud.js import { initSongs, renderSongs, onSongsHidden }
// byte-for-byte unchanged. The modules + this file form runtime-only import cycles (render/flash are
// imported back by add/progress/mine), fine like cloud⇄minna. See REFACTOR_FOLLOWUPS.md "Workstream S".

import { escapeHtml, songWords, songLevel } from '../../core/index.js';
import { destroyPlayer } from '../songs-youtube.js';
import { wireWordTaps } from '../word-lookup.js';
import { loadSongs } from '../../persistence/songs.js';
import { exitSpeakingMode, isSpeakingMode, setOnTakeSaved } from '../record-compare.js';
import { S, LV_CLASS, SONGS_SCOPE, body } from './state.js';
import { libraryHtml, loadLibrary, loadSong } from './library.js';
import { addHtml, runAnalyze, saveSong } from './add.js';
import { readHtml, toggleFurigana, mountSongPlayer, replayLine } from './read.js';
import { listenHtml, renderListen, resetListenStep, captureListenInputs, gradeListen, playListenLine } from './listen.js';
import { shadowHtml, wireShadow, renderShadow, songNav, clearNavSpeaking, playShadowSlice } from './shadow.js';
import { mineHtml, grammarRefHtml, savePhrase, goBrowseGrammar } from './mine.js';
import { toggleStar, restoreMode, noteMode, addOneWord, addAllNew, onSongTakeSaved } from './progress.js';

// ============================ render ============================
export function renderSongs() {
  if (!S.loaded) { S.loaded = true; loadLibrary().then(render); render(); return; } // optimistic paint from cache
  render();
}

// Exported so add.js (runAnalyze/saveSong) + progress.js (addOneWord/addAllNew) can re-render after a
// state mutation without threading a callback through (runtime-only cycle, like cloud⇄minna).
export function render() {
  const el = body(); if (!el) return;
  destroyPlayer(); // any prior song's player; song view re-mounts below
  if (S.view === 'song' && S.openSong) {
    el.innerHTML = songHtml(); mountSongPlayer();
    if (S.mode === 'shadow') wireShadow(el);   // record-compare delegates + waveforms
    songNav();                                  // the navbar speaking bar (shadow + account only; clears otherwise)
    return;
  }
  clearNavSpeaking();
  if (S.view === 'add') { el.innerHTML = addHtml(); return; }
  el.innerHTML = libraryHtml();
}

// ---- Song view shell (Read / Listen / Shadow / Mine / Grammar reference) ----
function songHtml() {
  const s = S.openSong;
  const lvl = songLevel(songWords(s.lines), null);
  const head = `
    <button class="st-back" data-act="back"><svg class="ic" aria-hidden="true"><use href="#i-back"/></svg> back to library</button>
    <div class="song-head">
      <div><div class="song-h-title jp">${escapeHtml(s.title)} ${lvl ? `<span class="lv ${LV_CLASS[lvl] || ''}">${lvl}</span>` : ''}</div><div class="song-h-sub">${escapeHtml(s.artist || '')}</div></div>
      <div class="mode-switch">
        <button class="mode-sw${S.mode === 'read' ? ' on' : ''}" data-act="mode" data-mode="read"><svg class="ic g" aria-hidden="true"><use href="#i-book"/></svg> Read</button>
        <button class="mode-sw${S.mode === 'listen' ? ' on' : ''}" data-act="mode" data-mode="listen"><svg class="ic g" aria-hidden="true"><use href="#i-headphones"/></svg> Listen</button>
        <button class="mode-sw${S.mode === 'shadow' ? ' on' : ''}" data-act="mode" data-mode="shadow"><svg class="ic g" aria-hidden="true"><use href="#i-mic"/></svg> Shadow</button>
        <button class="mode-sw${S.mode === 'mine' || S.mode === 'grammar' ? ' on' : ''}" data-act="mode" data-mode="mine"><svg class="ic g" aria-hidden="true"><use href="#i-tag"/></svg> Mine</button>
      </div>
    </div>`;
  // In Listen the video is MASKED (a cover over the still-playing iframe, not display:none which can
  // stop YT audio) — many lyric MVs burn the words into the frame, which would spoil the dictation.
  const masked = S.mode === 'listen';
  const player = s.youtubeId
    ? `<div class="sg-yt${masked ? ' masked' : ''}"><div id="sgPlayer"></div>${masked ? '<div class="sg-yt-mask"><svg class="ic" aria-hidden="true"><use href="#i-headphones"/></svg> audio only — listen and type</div>' : ''}</div>`
    : `<p class="add-note" style="margin:6px 0 12px"><svg class="ic" aria-hidden="true"><use href="#i-music"/></svg> No video linked — per-line audio uses a synthesized voice.</p>`;
  let content;
  if (S.mode === 'grammar') content = grammarRefHtml();
  else if (S.mode === 'mine') content = mineHtml();
  else if (S.mode === 'listen') content = listenHtml();
  else if (S.mode === 'shadow') content = shadowHtml();
  else content = readHtml();
  // The mode content lives in a stable wrapper so Listen can re-render its stepper per step WITHOUT
  // re-running render() (which destroys + re-mounts the YouTube player — an iframe reload every step).
  return head + player + `<div id="sgContent">${content}</div>`;
}

// ============================ handlers ============================
async function onClick(e) {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const act = t.dataset.act;
  if (act === 'add') { S.view = 'add'; S.add = { lyrics: '', url: '', title: '', artist: '', analysis: null, busy: false, error: '' }; render(); return; }
  if (act === 'back') { exitSpeakingMode(); S.view = 'library'; S.openSong = null; S.mode = 'read'; loadLibrary().then(render); render(); return; }
  if (act === 'signin') { document.getElementById('accountBtn').click(); return; }
  if (act === 'filter') { S.libFilter = t.dataset.filter; render(); return; }
  if (act === 'open') { await openById(t.dataset.id); return; }
  if (act === 'analyze' || act === 'reanalyze') { await runAnalyze(); return; }
  if (act === 'save') { await saveSong(); return; }
  if (act === 'mode') {
    const next = t.dataset.mode === 'mine' ? 'mine' : t.dataset.mode;
    if (S.mode === 'shadow' && next !== 'shadow') exitSpeakingMode();   // release the mic when leaving Shadow
    S.mode = next; if (S.mode !== 'grammar') S.grammarRef = null; noteMode(S.mode); render(); return;
  }
  if (act === 'grammar') { S.grammarRef = t.dataset.g; S.mode = 'grammar'; render(); return; }
  if (act === 'reveal') { const en = t.dataset.en || ''; t.classList.remove('hidden'); t.removeAttribute('data-act'); t.innerHTML = escapeHtml(en); return; }
  if (act === 'reveal-all') { document.querySelectorAll('#sgBody .l-en.hidden').forEach((el) => { el.classList.remove('hidden'); el.innerHTML = escapeHtml(el.dataset.en || ''); el.removeAttribute('data-act'); }); t.classList.toggle('on'); return; }
  if (act === 'furigana') { toggleFurigana(t); return; }
  if (act === 'replay') { replayLine(Number(t.dataset.ord), t.closest('.speak-btn'), e); return; }
  if (act === 'star') { toggleStar(Number(t.dataset.ord), t); return; }
  if (act === 'shadowslice') { playShadowSlice(Number(t.dataset.ord)); return; }
  // ---- Listen (dictation) stepper ----
  if (act === 'ldiff') { S.listen.diff = t.dataset.diff === 'full' ? 'full' : 'cloze'; resetListenStep(); renderListen(); return; }
  if (act === 'lplay') { playListenLine(false, t.closest('.cue-btn')); return; }
  if (act === 'lslow') { playListenLine(true, t.closest('.cue-btn')); return; }
  if (act === 'lcheck') { captureListenInputs(); gradeListen(); S.listen.checked = true; renderListen(); return; }
  if (act === 'lreveal') { captureListenInputs(); S.listen.revealed = true; renderListen(); return; }
  if (act === 'lnext') { S.listen.idx = Math.min(S.listen.idx + 1, S.openSong.lines.length); resetListenStep(); renderListen(); return; }
  if (act === 'lrestart') { S.listen.idx = 0; S.listen.done.clear(); resetListenStep(); renderListen(); return; }
  if (act === 'addword') { addOneWord(t.dataset.lemma); return; }
  if (act === 'addall') { addAllNew(); return; }
  if (act === 'savephrase') { await savePhrase(Number(t.dataset.ord)); return; }
  if (act === 'browse-grammar') { goBrowseGrammar(t.dataset.g); return; }
}

async function openById(id) {
  try {
    const s = await loadSong(id);
    if (!s) return;
    S.openSong = s; S.view = 'song'; S.mode = restoreMode(s.id); S.grammarRef = null;
    render();
  } catch (e) { /* offline / gone — stay on library */ }
}

// Exported so mine.js (savePhrase) can surface a transient status. The auto-clearing #syncStatus pill.
export function flash(msg) {
  const el = document.getElementById('syncStatus'); if (!el) return;
  el.textContent = msg; setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 2200);
}

// ============================ lifecycle ============================
export function initSongs() {
  loadSongs();   // hydrate state.songsStore (the progress blob) from localStorage before any render
  const el = body(); if (!el) return;
  if (!el._sgWired) {
    el._sgWired = true;
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKeydown);
    wireWordTaps(el);
    // Shadow take-saved → the shared "spoke today" day-streak. Filtered to SONGS_SCOPE so a
    // Minna/Self-Talk take never marks song practice; the engine's hook is multi-listener now, so
    // registering this doesn't clobber Self-Talk's.
    setOnTakeSaved((scope, itemKey) => { if (scope === SONGS_SCOPE) onSongTakeSaved(itemKey); });
    // Release the mic if the BROWSER tab is hidden while shadowing (the in-app tab-leave hook doesn't
    // fire on a browser-tab change) — guarded on #panel-songs active so it doesn't fight Minna/Self-Talk.
    document.addEventListener('visibilitychange', handleSongsBrowserTabHidden);
  }
}
function handleSongsBrowserTabHidden() {
  if (!document.hidden || !isSpeakingMode()) return;
  const panel = document.getElementById('panel-songs');
  if (!panel || !panel.classList.contains('active')) return;
  exitSpeakingMode();
  renderShadow(); songNav();   // repaint the controls/bar to the released state
}
// Enter in a Listen input = Check (the dictation shortcut). Ignored once the step is revealed (the
// gaps/input have frozen) or outside Listen.
function onKeydown(e) {
  if (e.key !== 'Enter') return;
  if (!e.target.closest('.gap-inp, .listen-full-inp')) return;
  e.preventDefault();
  if (S.mode !== 'listen' || !S.listen || S.listen.revealed) return;
  captureListenInputs(); gradeListen(); S.listen.checked = true; renderListen();
}
// Tab-leave teardown (main.js wires it): release the mic, clear the navbar speaking bar, and destroy
// the YouTube player so a backgrounded tab holds no live mic stream / iframe.
export function onSongsHidden() { exitSpeakingMode(); clearNavSpeaking(); destroyPlayer(); }
