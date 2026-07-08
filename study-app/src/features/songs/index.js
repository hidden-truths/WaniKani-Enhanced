// 歌 / Songs — package orchestrator. Owns the top-level render dispatch (library / add / song-view),
// the song-view shell (mode switch + player + the stable #sgContent wrapper), the once-attached
// delegated click/keydown (a declarative ACTIONS map — adding a feature adds an entry, it doesn't
// grow a dispatcher), navigation (openById + the S.nav epoch that drops stale async resolutions),
// and the lifecycle (initSongs/onSongsHidden). Each MODE + surface lives in its own sibling module
// behind this barrel; shared mutable view-state is the `S` object in ./state.js (mutated in place —
// the record-compare pattern). features/songs.js is a thin re-export of this file, so main.js +
// cloud.js import { initSongs, renderSongs, onSongsHidden } byte-for-byte unchanged. The modules +
// this file form runtime-only import cycles (render/showLibrary/refreshLibrary are imported back by
// add/progress/edit), fine like cloud⇄minna. (Workstream S — the refactor record is in ROADMAP.html.)

import { escapeHtml, songWords, songLevel } from '../../core/index.js';
import { state } from '../../state.js';
import { destroyPlayer } from '../songs-youtube.js';
import { wireWordTaps } from '../word-lookup.js';
import { loadSongs } from '../../persistence/songs.js';
import { exitSpeakingMode, setOnTakeSaved } from '../record-compare.js';
import { clearSpeakingBar, releaseMicIfHidden } from '../speaking-bar.js';
import { S, LV_CLASS, SONGS_SCOPE, body } from './state.js';
import { libraryHtml, loadLibrary, loadSong, known } from './library.js';
import { addHtml, runAnalyze, saveSong } from './add.js';
import { startEdit, cancelEdit, saveEdit, deleteSong } from './edit.js';
import { readHtml, toggleFurigana, mountSongPlayer, replayLine } from './read.js';
import { listenHtml, renderListen, resetListenStep, captureListenInputs, gradeListen, playListenLine } from './listen.js';
import { shadowHtml, wireShadow, renderShadow, songNav, playShadowSlice } from './shadow.js';
import { mineHtml, vocabRailHtml, grammarRefHtml, savePhrase, goBrowseGrammar } from './mine.js';
import { toggleStar, restoreMode, noteMode, addOneWord, addAllNew, onSongTakeSaved } from './progress.js';

// ============================ render ============================
export function renderSongs() {
  if (!S.loaded) { S.loaded = true; loadLibrary().then(render); render(); return; } // optimistic paint from cache
  render();
}

// Exported so add.js (runAnalyze/saveSong), progress.js (addOneWord/addAllNew) and edit.js can
// re-render after a state mutation without threading a callback through (runtime-only cycle, like
// cloud⇄minna).
export function render() {
  const el = body(); if (!el) return;
  destroyPlayer(); // any prior song's player; song view re-mounts below
  if (S.view === 'song' && S.openSong) {
    el.innerHTML = songHtml(); mountSongPlayer();
    if (S.mode === 'shadow') wireShadow(el);   // record-compare delegates + waveforms
    songNav();                                  // the navbar speaking bar (shadow + account only; clears otherwise)
    return;
  }
  clearSpeakingBar();
  if (S.view === 'add') { el.innerHTML = addHtml(); return; }
  el.innerHTML = libraryHtml();
}

// The song's JLPT difficulty profile (the mock's stacked segmented bar + legend) — % of the song's
// levelled content words at each level. Empty when no word carries a level.
const PF = { N5: 'n5', N4: 'n4', N3: 'n3', N2: 'n2', N1: 'n1' };
function jlptProfileHtml(words) {
  const order = ['N5', 'N4', 'N3', 'N2', 'N1'];
  const counts = {}; let withLvl = 0;
  for (const w of words) if (order.includes(w.jlpt)) { counts[w.jlpt] = (counts[w.jlpt] || 0) + 1; withLvl++; }
  if (!withLvl) return '';
  const present = order.filter((l) => counts[l]);
  const pc = (l) => Math.round((counts[l] / withLvl) * 100);
  const segs = present.map((l, i) => `<span class="pf-seg ${PF[l]}" style="width:${pc(l)}%;animation-delay:${(0.4 + i * 0.1).toFixed(1)}s"></span>`).join('');
  const legend = present.map((l) => `<span><i class="${PF[l]}"></i>${l} ${pc(l)}%</span>`).join('');
  return `<div class="jlpt-profile">
    <div class="pf-head"><span class="pf-title">Difficulty</span><span class="pf-sum">${words.length} word${words.length === 1 ? '' : 's'}</span></div>
    <div class="pf-bar">${segs}</div>
    <div class="pf-legend">${legend}</div>
  </div>`;
}

// ---- Song view shell (the mock's two-column STAGE: ctx-row · hero play-card · on-demand video bay ·
// the mode content (#sgContent — Read's lyric-stage, else Listen/Shadow/Mine/Grammar) · the mined-vocab
// rail beside Read). The grid goes 2-col only in Read (.rd); other modes span full width. ----
function songHtml() {
  const s = S.openSong;
  const words = songWords(s.lines);
  const lvl = songLevel(words, null);
  const k = known();
  const dk = new Set(state.DATA.map((v) => v.jp));
  const newWords = words.filter((w) => !k.has(w.lemma) && !dk.has(w.lemma));
  const mined = words.length - newWords.length;                       // words already in the deck
  const minedPct = words.length ? Math.round((mined / words.length) * 100) : 0;
  const off = Math.round(151 * (1 - minedPct / 100));                 // ring meter dashoffset (C≈151)
  const modeLabel = { read: 'Read', listen: 'Listen', shadow: 'Shadow', mine: 'Mine', grammar: 'Mine' }[S.mode] || 'Read';
  const glyph = ((s.title || '歌').trim().charAt(0)) || '歌';

  // per-song mode tabs (Read/Listen/Shadow/Mine) — JP glyph + label, active=brand fill.
  const MT = [['read', '読', 'Read'], ['listen', '聴', 'Listen'], ['shadow', '影', 'Shadow'], ['mine', '採', 'Mine']];
  const tabActive = (m) => S.mode === m || (m === 'mine' && S.mode === 'grammar');
  const tabs = MT.map(([m, gl, label]) => `<button class="mtab${tabActive(m) ? ' active' : ''}" data-act="mode" data-mode="${m}" role="tab" aria-selected="${tabActive(m)}"><span class="mi jp">${gl}</span> ${label}</button>`).join('');

  // hero utility row: on-demand "Play with video" (mock — the video isn't shown until asked) + furigana.
  const actions = `<div class="hero-actions">
    ${!s.youtubeId
      ? `<span class="add-note"><svg class="ic" aria-hidden="true"><use href="#i-music"/></svg> No video linked — per-line audio is synthesized.</span>`
      : S.videoFailed
        ? `<span class="add-note"><svg class="ic" aria-hidden="true"><use href="#i-music"/></svg> Video unavailable — per-line audio is synthesized.</span>`
        : `<button class="btn btn-primary play-video" data-act="playvideo"><span class="tri"><svg class="ic" aria-hidden="true"><use href="#i-play"/></svg></span> ${S.videoOn ? 'Video on' : 'Play with video'}</button>`}
    <button class="chip fg-toggle on" data-act="furigana" aria-pressed="true"><span class="sw"></span><span class="jp">ふりがな</span></button>
  </div>`;

  const hero = `<section class="song-hero">
    <div class="hero-inner">
      <div class="disc" aria-hidden="true"><span class="label"><span class="glyph jp">${escapeHtml(glyph)}</span></span><span class="spindle"></span></div>
      <div class="song-head-main">
        ${S.editing
      ? `<div class="song-edit" style="display:flex;flex-direction:column;gap:8px;max-width:440px;margin-bottom:10px">
            <input id="sgEditTitle" class="inp jp" value="${escapeHtml(S.editing.title)}" placeholder="Song title" aria-label="Song title">
            <input id="sgEditArtist" class="inp" value="${escapeHtml(S.editing.artist)}" placeholder="Artist" aria-label="Artist">
            ${S.editing.error ? `<span class="sg-err">${escapeHtml(S.editing.error)}</span>` : ''}
            <div style="display:flex;gap:8px">
              <button class="btn primary" data-act="songeditsave"><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg> Save</button>
              <button class="btn ghost" data-act="songeditcancel">Cancel</button>
            </div>
          </div>`
      : `<h1 class="song-title jp">${escapeHtml(s.title)}${lvl ? ` <span class="lv ${LV_CLASS[lvl] || ''}">${lvl}</span>` : ''}</h1>
        ${s.artist ? `<div class="song-artist">${escapeHtml(s.artist)}</div>` : ''}`}
        <div class="mode-tabs" role="tablist" aria-label="Song practice modes">${tabs}</div>
        ${actions}
      </div>
      <div class="hero-side">
        ${jlptProfileHtml(words)}
        <div class="mine-progress">
          <div class="mine-ring"><svg viewBox="0 0 58 58"><circle class="track" cx="29" cy="29" r="24"/><circle class="meter" cx="29" cy="29" r="24" style="stroke-dasharray:151;stroke-dashoffset:${off}"/></svg><span class="pct">${minedPct}%</span></div>
          <div class="mp-text"><b>${mined}</b> / ${words.length} word${words.length === 1 ? '' : 's'} mined<div class="mp-hint">${newWords.length ? 'add the rest from the rail →' : 'all mined ✓'}</div></div>
        </div>
      </div>
    </div>
  </section>`;

  // On-demand video bay (outside #sgContent so a Listen step re-render never reloads the iframe).
  // Read shows it only after "Play with video"; Listen masks it (audio only); Shadow needs it for slices.
  const showBay = s.youtubeId && !S.videoFailed && (S.videoOn || S.mode === 'listen' || S.mode === 'shadow');
  const masked = S.mode === 'listen';
  const bay = showBay
    ? `<div class="song-player-bay"><div class="sg-yt${masked ? ' masked' : ''}"><div id="sgPlayer"></div>${masked ? '<div class="sg-yt-mask"><svg class="ic" aria-hidden="true"><use href="#i-headphones"/></svg> audio only — listen and type</div>' : ''}</div></div>`
    : '';

  let content;
  if (S.mode === 'grammar') content = grammarRefHtml();
  else if (S.mode === 'mine') content = mineHtml();
  else if (S.mode === 'listen') content = listenHtml();
  else if (S.mode === 'shadow') content = shadowHtml();
  else content = `<section class="lyric-stage">${readHtml()}</section>`;
  // The mode content lives in a stable wrapper so Listen can re-render its stepper per step WITHOUT
  // re-running render() (which destroys + re-mounts the YouTube player). The vocab rail sits beside Read.
  return `<div class="songs-grid${S.mode === 'read' ? ' rd' : ''}">
    <div class="ctx-row"><span class="sg-crumb">歌 · Songs · ${modeLabel}</span><span class="spacer"></span>${s.custom && !S.editing ? `<button class="st-back" data-act="songedit"><svg class="ic" aria-hidden="true"><use href="#i-edit"/></svg> Edit</button><button class="st-back" data-act="songdelete"><svg class="ic" aria-hidden="true"><use href="#i-trash"/></svg> Delete</button>` : ''}<button class="st-back" data-act="back"><svg class="ic" aria-hidden="true"><use href="#i-back"/></svg> Library</button></div>
    ${hero}
    ${bay}
    <div id="sgContent">${content}</div>
    ${S.mode === 'read' ? vocabRailHtml() : ''}
  </div>`;
}

// ============================ navigation ============================
// One navigation epoch: every view change bumps it, so an in-flight async open (openById on a slow
// network) resolving AFTER the user moved on can tell, and drops its result instead of clobbering
// the current view (or letting the FIRST-clicked of two rapid opens win over the LAST-clicked).
export function bumpNav() { return ++S.nav; }

// Reset to the library view (Back + a successful delete) and refresh the grid from the server.
export function showLibrary() {
  S.view = 'library'; S.openSong = null; S.mode = 'read'; S.videoOn = false; S.videoFailed = false; S.editing = null;
  bumpNav();
  refreshLibrary();
}

// Optimistic repaint now + repaint again when the network refresh lands. render() reads the CURRENT
// S, so the late repaint is always of whatever view the user is on — never a stale one.
export function refreshLibrary() { loadLibrary().then(render); render(); }

async function openById(id) {
  const nav = bumpNav();
  try {
    const s = await loadSong(id);
    if (!s || nav !== S.nav) return;   // gone/unauthorized, or the user navigated on mid-flight
    S.openSong = s; S.view = 'song'; S.mode = restoreMode(s.id); S.grammarRef = null; S.videoOn = false; S.videoFailed = false; S.editing = null;
    render();
  } catch (e) { /* offline / gone — stay on library */ }
}

// ============================ handlers ============================
// Read the inline edit form's current values (the DOM is the source of the in-progress keystrokes;
// S.editing only learns them here, on save, so a re-render mid-typing can't happen).
function readEditDraft() {
  return {
    title: document.getElementById('sgEditTitle')?.value || '',
    artist: document.getElementById('sgEditArtist')?.value || '',
  };
}

// The delegated-click action table (buttons carry data-act). One entry per action — a new feature
// registers here instead of growing a dispatcher function. Handlers get (target, event).
const ACTIONS = {
  add: () => { S.view = 'add'; S.add = { lyrics: '', url: '', title: '', artist: '', analysis: null, busy: false, error: '' }; bumpNav(); render(); },
  back: () => { exitSpeakingMode(); showLibrary(); },
  playvideo: () => { S.videoOn = true; render(); },   // mount + autoplay the on-demand video bay (Read)
  // ---- Edit / delete one of the viewer's OWN songs (owner-scoped; flows live in ./edit.js) ----
  songedit: () => startEdit(),
  songeditcancel: () => cancelEdit(),
  songeditsave: () => saveEdit(readEditDraft()),
  songdelete: () => deleteSong(),
  signin: () => { document.getElementById('accountBtn').click(); },
  filter: (t) => { S.libFilter = t.dataset.filter; render(); },
  open: (t) => openById(t.dataset.id),
  analyze: () => runAnalyze(),
  reanalyze: () => runAnalyze(),
  save: () => saveSong(),
  mode: (t) => {
    const next = t.dataset.mode === 'mine' ? 'mine' : t.dataset.mode;
    if (S.mode === 'shadow' && next !== 'shadow') exitSpeakingMode();   // release the mic when leaving Shadow
    S.mode = next; S.videoOn = false; if (S.mode !== 'grammar') S.grammarRef = null; noteMode(S.mode); render();
  },
  grammar: (t) => { S.grammarRef = t.dataset.g; S.mode = 'grammar'; render(); },
  reveal: (t) => { const en = t.dataset.en || ''; t.classList.remove('hidden'); t.removeAttribute('data-act'); t.innerHTML = escapeHtml(en); },
  'reveal-all': (t) => {
    document.querySelectorAll('#sgBody .ll .en.hidden').forEach((el) => { el.classList.remove('hidden'); el.innerHTML = escapeHtml(el.dataset.en || ''); el.removeAttribute('data-act'); });
    t.classList.toggle('on');
  },
  furigana: (t) => toggleFurigana(t),
  replay: (t, e) => replayLine(Number(t.dataset.ord), t.closest('.speak-btn'), e),
  star: (t) => toggleStar(Number(t.dataset.ord), t),
  shadowslice: (t) => playShadowSlice(Number(t.dataset.ord)),
  // ---- Listen (dictation) stepper ----
  ldiff: (t) => { S.listen.diff = t.dataset.diff === 'full' ? 'full' : 'cloze'; resetListenStep(); renderListen(); },
  lplay: (t) => playListenLine(false, t.closest('.cue-btn')),
  lslow: (t) => playListenLine(true, t.closest('.cue-btn')),
  lcheck: () => { captureListenInputs(); gradeListen(); S.listen.checked = true; renderListen(); },
  lreveal: () => { captureListenInputs(); S.listen.revealed = true; renderListen(); },
  lnext: () => { S.listen.idx = Math.min(S.listen.idx + 1, S.openSong.lines.length); resetListenStep(); renderListen(); },
  lrestart: () => { S.listen.idx = 0; S.listen.done.clear(); resetListenStep(); renderListen(); },
  addword: (t) => addOneWord(t.dataset.lemma),
  addall: () => addAllNew(),
  savephrase: (t) => savePhrase(Number(t.dataset.ord)),
  'browse-grammar': (t) => goBrowseGrammar(t.dataset.g),
};

function onClick(e) {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const handler = ACTIONS[t.dataset.act];
  if (handler) handler(t, e);
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
  const active = () => { const p = document.getElementById('panel-songs'); return !!p && p.classList.contains('active'); };
  if (releaseMicIfHidden(active)) { renderShadow(); songNav(); }   // repaint the controls/bar to the released state
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
export function onSongsHidden() { exitSpeakingMode(); clearSpeakingBar(); destroyPlayer(); }
