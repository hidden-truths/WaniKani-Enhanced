// 歌 / Songs — song & lyric analysis tab. Library (your private songs + public starters) → Add
// (paste lyrics + a YouTube link → full-auto analysis → review → save) → Song view (Read: the lyric
// viewer; Mine: vocab + grammar). Song CONTENT is server-authoritative (the sentence store); this
// module fetches + renders it and turns it into study material. Listen + Shadow modes are specced in
// SONGS.md and arrive in later phases. Anon-readable (starters); authoring requires an account.
//
// Reuse: wireWordTaps + overlayTokens (tap-a-word), the furigana flip, the grammar catalog, the
// unified audio player (playItem, 'songs' context), vocab-activation (Source:歌 custom cards), and
// the YouTube IFrame wrapper. See SONGS.md for the architecture + dead-ends.

import { state } from '../state.js';
import { api, account } from './cloud-core.js';
import {
  escapeHtml, plainText, segmentsToRuby, overlayTokens,
  parseYouTubeId, songWords, knownHeadwords, coverage, bucketByJlpt, songLevel, songGrammar,
} from '../core/index.js';
import { grammarLabel, grammarJlpt } from '../data/grammar.js';
import { playItem, cycleMod } from './audio.js';
import { wireWordTaps } from './word-lookup.js';
import { mountPlayer, destroyPlayer, playSlice } from './songs-youtube.js';
import { loadCustom, saveCustom } from '../persistence/custom.js';
import { rebuildData, refreshAfterVerbChange } from './custom-cards.js';

const CACHE_KEY = 'jpverbs_songs_cache';
const POS_CAT = { VERB: 'verb', ADJ: 'adjective', NOUN: 'noun', PROPN: 'noun', ADV: 'adverb' };
const LV_CLASS = { N5: 'lv-n5', N4: 'lv-n4', N3: 'lv-n3', N2: 'lv-n2', N1: 'lv-n1' };

// ---- module view state ----
let loaded = false;
let library = [];            // [{id,title,artist,youtubeId,source,custom,lineCount,timedCount,words}]
let libFilter = 'all';        // 'all' | 'mine' | 'starter'
let view = 'library';         // 'library' | 'add' | 'song'
let openSong = null;          // the assembled song {id,title,artist,youtubeId,lines,…} when viewing one
let mode = 'read';            // 'read' | 'mine' | 'grammar'
let grammarRef = null;        // the grammar id currently open in the reference panel
let add = { lyrics: '', url: '', title: '', artist: '', analysis: null, busy: false, error: '' };

function body() { return document.getElementById('sgBody'); }

// ---- read-through cache + fetch ----
function readCache() { try { const o = JSON.parse(localStorage.getItem(CACHE_KEY)); if (Array.isArray(o)) return o; } catch (e) { /* */ } return []; }
function writeCache(songs) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(songs)); } catch (e) { /* */ } }

async function loadLibrary() {
  try { const r = await api('/v1/songs'); library = (r && r.songs) || []; writeCache(library); }
  catch (e) { if (!library.length) library = readCache(); }
}
// Flatten the server's AssembledSentence line (grammar in tags, en in translations, tokens in
// annotation, timing on link) into the song-line shape core/songs.js + the render operate on. Line
// ordinal = array index (server returns them sorted + contiguous; compactLink omits a falsy 0).
function normalizeLine(s, i) {
  return {
    ordinal: i,
    text: s.text,
    furigana: s.furigana || null,
    en: (s.translations && s.translations.en) || '',
    grammar: (s.tags && s.tags.grammar) || [],
    tokens: (s.annotation && s.annotation.tokens) || [],
    clipStartMs: (s.link && s.link.clip_start_ms != null) ? s.link.clip_start_ms : null,
  };
}
async function loadSong(id) {
  const r = await api('/v1/songs/' + encodeURIComponent(id));
  const s = r && r.song;
  if (s) s.lines = (s.lines || []).map(normalizeLine);
  return s;
}

// ---- the known-headword set (recomputed per render; cheap) ----
function known() { return knownHeadwords(state.store.cards, state.DATA); }

// ============================ vocab activation (Source:歌) ============================
// Mirror the みんなの日本語 activation: a mined word becomes a tagged dictionary-form custom card,
// idempotent by a stable songKey, joining the deck/SRS/Browse/Stats + syncing under `custom-verbs`.
// Only adds words NOT already in the deck (built-in or custom) — known/existing words aren't re-added.
function activateSongWords(songExtId, songTitle, words) {
  const cs = loadCustom();
  const existingJp = new Set(state.DATA.map((v) => v.jp));
  const existingKeys = new Set(cs.verbs.map((v) => v.songKey).filter(Boolean));
  let added = 0;
  for (const w of words) {
    const songKey = 'song-' + songExtId + '-' + w.lemma;
    if (existingKeys.has(songKey)) continue;
    if (existingJp.has(w.lemma)) continue; // already in the deck — don't duplicate
    cs.seq = (cs.seq || 100) + 1;
    cs.verbs.push({
      rank: cs.seq, jp: w.lemma, read: w.reading || w.lemma, mean: w.gloss || '',
      cat: POS_CAT[w.pos] || 'noun', type: '', jlpt: w.jlpt || '', trans: '',
      tags: ['歌', 'song-' + songExtId, 'custom'], song: true, songId: songExtId, songTitle, songKey,
      mnem: '', tip: '', ex: [], accent: null, levels: null, custom: true,
    });
    existingKeys.add(songKey); existingJp.add(w.lemma); added++;
  }
  if (added) { saveCustom(cs); rebuildData(); refreshAfterVerbChange(); }
  return added;
}

// ============================ render ============================
export function renderSongs() {
  if (!loaded) { loaded = true; loadLibrary().then(render); render(); return; } // optimistic paint from cache
  render();
}

function render() {
  const el = body(); if (!el) return;
  destroyPlayer(); // any prior song's player; song view re-mounts below
  if (view === 'add') { el.innerHTML = addHtml(); return; }
  if (view === 'song' && openSong) { el.innerHTML = songHtml(); mountSongPlayer(); return; }
  el.innerHTML = libraryHtml();
}

// ---- Library ----
function libraryHtml() {
  const k = known();
  const shown = library.filter((s) => libFilter === 'all' || (libFilter === 'mine' ? s.custom : !s.custom));
  const mine = library.filter((s) => s.custom).length;
  const starter = library.length - mine;
  const cards = shown.map((s) => songCardHtml(s, k)).join('');
  return `
    <div class="sg-intro">
      <p class="st-kicker">歌 · songs</p>
      <p class="st-lede">Study real songs as listening, reading, and speaking practice. Add your own (paste the lyrics, link the video) or start from the bundled set.</p>
    </div>
    <div class="toolbar sg-toolbar">
      <button class="chip primary" data-act="add"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg> Add a song</button>
      <span style="flex:1"></span>
      <span class="filter-label">Show</span>
      <div class="chips" role="radiogroup" aria-label="Show songs">
        <button class="chip sg-filter${libFilter === 'all' ? ' active' : ''}" data-act="filter" data-filter="all">All</button>
        <button class="chip sg-filter${libFilter === 'mine' ? ' active' : ''}" data-act="filter" data-filter="mine">Mine</button>
        <button class="chip sg-filter${libFilter === 'starter' ? ' active' : ''}" data-act="filter" data-filter="starter">Starter</button>
      </div>
    </div>
    ${shown.length ? `<div class="song-grid">${cards}</div>`
      : `<p class="sg-empty">${library.length ? 'No songs match this filter.' : 'No songs yet — add one to get started.'}</p>`}`;
}

function songCardHtml(s, k) {
  const cov = coverage(s.words, k);
  const lvl = songLevel(s.words, null);
  const lvlBadge = lvl ? `<span class="lv ${LV_CLASS[lvl] || ''}">${lvl}</span>` : '';
  const src = s.custom ? '<span class="src-badge src-mine">MINE</span>' : '<span class="src-badge src-starter">STARTER</span>';
  const timed = s.timedCount > 0
    ? `<span class="sc-dot"><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg> ${s.timedCount} of ${s.lineCount} timed</span>`
    : `<span class="sc-dot sc-warn"><svg class="ic" aria-hidden="true"><use href="#i-clock"/></svg> not timed · ${s.lineCount} lines</span>`;
  return `
    <button class="song-card${s.custom ? '' : ' starter'}" data-act="open" data-id="${escapeHtml(s.id)}" type="button">
      <span class="sc-row">
        <span><span class="sc-title jp">${escapeHtml(s.title)}</span><span class="sc-artist">${escapeHtml(s.artist || '')}</span></span>
        <span class="ring" style="--p:${cov.pct}%"><span>${cov.pct}</span></span>
      </span>
      <span class="sc-cov"><span class="sc-cov-top"><span>you know</span><b>${cov.pct}%</b></span><span class="cov-bar"><i class="cov-fill" style="width:${cov.pct}%"></i></span></span>
      <span class="sc-meta">${lvlBadge}${src}${timed}</span>
    </button>`;
}

// ---- Add (paste → analyze → review → save) ----
function addHtml() {
  if (!account) {
    return `<button class="st-back" data-act="back"><svg class="ic" aria-hidden="true"><use href="#i-back"/></svg> back</button>
      <div class="signup-banner sg-gate"><svg class="ic" style="font-size:22px"><use href="#i-user"/></svg>
      <div class="sb-text"><b>Sign in to add a song.</b> Your pasted lyrics are stored privately to your account. Reading the bundled starter songs needs no account.</div>
      <button class="btn srs" data-act="signin">Sign in</button></div>`;
  }
  const a = add.analysis;
  const steps = (n) => `<div class="steps">
    <span class="step ${n > 1 ? 'done' : 'on'}"><span class="sn">${n > 1 ? '<svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>' : '1'}</span> Paste</span>
    <span class="step ${n === 2 ? 'on' : ''}"><span class="sn">2</span> Review</span>
    <span class="step ${n === 3 ? 'on' : ''}"><span class="sn">3</span> Save</span></div>`;
  const back = `<button class="st-back" data-act="back"><svg class="ic" aria-hidden="true"><use href="#i-back"/></svg> back to library</button>`;

  if (!a) {
    return `${back}${steps(1)}
      <label class="field-lbl" for="sgLyrics">Lyrics — paste from anywhere</label>
      <textarea id="sgLyrics" class="ta jp" placeholder="一行ずつ歌詞を貼り付けてください…">${escapeHtml(add.lyrics)}</textarea>
      <label class="field-lbl" for="sgUrl">YouTube link</label>
      <input id="sgUrl" class="inp" placeholder="https://www.youtube.com/watch?v=…" value="${escapeHtml(add.url)}">
      <p class="add-note"><svg class="ic" aria-hidden="true"><use href="#i-music"/></svg> Title &amp; artist auto-fill from the video. The audio stays on YouTube — we embed its player, we don't re-host it.</p>
      <div class="add-foot">
        <p class="add-note"><svg class="ic" aria-hidden="true"><use href="#i-alert"/></svg> ${add.error ? `<span class="sg-err">${escapeHtml(add.error)}</span>` : 'Lyrics you paste are stored privately to your account.'}</p>
        <button class="chip primary" data-act="analyze"${add.busy ? ' disabled' : ''}><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg> ${add.busy ? 'Analyzing…' : 'Analyze'}</button>
      </div>`;
  }
  // Review step. The analyze response lines are already flat (en/grammar/tokens/flags).
  const flagged = a.lines.filter((l) => l.flags.length).length;
  const k = known();
  const distinct = songWords([{ tokens: a.lines.flatMap((l) => l.tokens || []) }]);
  const newCount = distinct.filter((w) => !k.has(w.lemma)).length;
  const rows = a.lines.map((l) => {
    const ruby = l.furigana ? segmentsToRuby(l.furigana) : escapeHtml(l.text);
    const warn = l.flags.length
      ? `<div class="rev-warn"><svg class="ic" aria-hidden="true"><use href="#i-alert"/></svg> check this line (${l.flags.join(', ')})</div>` : '';
    return `<div class="rev-line${l.flags.length ? ' flag' : ''}"><div><div class="rev-jp jp">${ruby}</div><div class="rev-en">${escapeHtml(l.en)}</div>${warn}</div></div>`;
  }).join('');
  return `${back}${steps(2)}
    <div class="profile-chips">
      <span class="pchip plain"><svg class="ic" aria-hidden="true"><use href="#i-music"/></svg> ${escapeHtml(add.title || 'Untitled')}${add.artist ? ' · ' + escapeHtml(add.artist) : ''}</span>
      <span style="flex:1"></span>
      ${a.profile.jlpt ? `<span class="pchip info">${escapeHtml(a.profile.jlpt)}</span>` : ''}
      <span class="pchip info"><svg class="ic" aria-hidden="true"><use href="#i-tag"/></svg> ${a.profile.grammarCount} grammar point${a.profile.grammarCount === 1 ? '' : 's'}</span>
      <span class="pchip plain"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg> ${newCount} new word${newCount === 1 ? '' : 's'}</span>
    </div>
    <div class="rev">${rows}</div>
    <div class="add-foot">
      <p class="add-note"><svg class="ic" aria-hidden="true"><use href="#i-alert"/></svg> Auto-generated${flagged ? ` — ${flagged} line${flagged === 1 ? '' : 's'} flagged to check` : ''}. Review, then it joins your library.</p>
      <span style="display:flex;gap:8px">
        <button class="btn ghost" data-act="reanalyze"${add.busy ? ' disabled' : ''}><svg class="ic" aria-hidden="true"><use href="#i-refresh"/></svg> Re-analyze</button>
        <button class="btn srs" data-act="save"${add.busy ? ' disabled' : ''}><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg> ${add.busy ? 'Saving…' : 'Save to my library'}</button>
      </span>
    </div>`;
}

// ---- Song view (Read / Mine / Grammar reference) ----
function songHtml() {
  const s = openSong;
  const lvl = songLevel(songWords(s.lines), null);
  const head = `
    <button class="st-back" data-act="back"><svg class="ic" aria-hidden="true"><use href="#i-back"/></svg> back to library</button>
    <div class="song-head">
      <div><div class="song-h-title jp">${escapeHtml(s.title)} ${lvl ? `<span class="lv ${LV_CLASS[lvl] || ''}">${lvl}</span>` : ''}</div><div class="song-h-sub">${escapeHtml(s.artist || '')}</div></div>
      <div class="mode-switch">
        <button class="mode-sw${mode === 'read' ? ' on' : ''}" data-act="mode" data-mode="read"><svg class="ic g" aria-hidden="true"><use href="#i-book"/></svg> Read</button>
        <button class="mode-sw" data-act="mode" data-mode="listen" disabled title="Listen — coming soon"><svg class="ic" aria-hidden="true"><use href="#i-headphones"/></svg> Listen</button>
        <button class="mode-sw" data-act="mode" data-mode="shadow" disabled title="Shadow — coming soon"><svg class="ic" aria-hidden="true"><use href="#i-mic"/></svg> Shadow</button>
        <button class="mode-sw${mode === 'mine' || mode === 'grammar' ? ' on' : ''}" data-act="mode" data-mode="mine"><svg class="ic g" aria-hidden="true"><use href="#i-tag"/></svg> Mine</button>
      </div>
    </div>`;
  const player = s.youtubeId
    ? `<div class="sg-yt"><div id="sgPlayer"></div></div>`
    : `<p class="add-note" style="margin:6px 0 12px"><svg class="ic" aria-hidden="true"><use href="#i-music"/></svg> No video linked — per-line audio uses a synthesized voice.</p>`;
  let content;
  if (mode === 'grammar') content = grammarRefHtml();
  else if (mode === 'mine') content = mineHtml();
  else content = readHtml();
  return head + player + content;
}

function readHtml() {
  const s = openSong;
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
    return `<div class="lyric" data-ord="${i}">
      <div class="l-top">
        <div class="l-jp jp">${jp}</div>
        <div class="l-ctl"><button class="speak-btn sm" data-act="replay" data-ord="${i}" aria-label="Replay line" title="Replay line"><svg class="ic" aria-hidden="true"><use href="#i-play"/></svg></button></div>
      </div>
      ${gram ? `<div class="gram-row">${gram}</div>` : ''}
      ${enRow}
    </div>`;
  }).join('');
  return `${ttoolbar}<div class="lyrics">${lines}</div>`;
}

function mineHtml() {
  const s = openSong;
  const k = known();
  const dk = new Set(state.DATA.map((v) => v.jp)); // every deck headword (added but unstudied → 'added')
  const words = songWords(s.lines);
  const buckets = bucketByJlpt(words, k, dk);
  const newWords = words.filter((w) => !k.has(w.lemma) && !dk.has(w.lemma));
  const grams = songGrammar(s.lines);
  const badge = { known: '<span class="kn known">KNOWN</span>', added: '<span class="kn added">ADDED</span>' };
  const wordRows = buckets.map((b) => {
    const head = `<div class="lvl-head">${b.level === '?' ? 'Other' : b.level}</div>`;
    const rows = b.words.map((w) => `
      <div class="wrow"><span class="wj jp">${escapeHtml(w.lemma)}</span><span class="wr jp">${escapeHtml(w.reading || '')}</span><span class="wm">${escapeHtml(w.gloss || '')}</span>
      ${badge[w.status]
        || `<span class="kn new">NEW</span><button class="addw" data-act="addword" data-lemma="${escapeHtml(w.lemma)}" title="Add to deck"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg></button>`}</div>`).join('');
    return head + rows;
  }).join('');
  const gramRows = grams.map((g) => `
    <div class="grow" data-act="grammar" data-g="${escapeHtml(g.id)}" role="button" tabindex="0">
      <span class="gp jp">${escapeHtml(grammarLabel(g.id))}</span><span class="lv ${LV_CLASS[grammarJlpt(g.id)] || ''}">${escapeHtml(grammarJlpt(g.id) || '')}</span>
      <span class="gcount">${g.count} line${g.count === 1 ? '' : 's'}</span><svg class="ic" style="color:var(--ichidan)" aria-hidden="true"><use href="#i-chevron"/></svg></div>`).join('');
  return `
    <div class="song-head" style="align-items:center;margin-top:4px">
      <div class="song-h-sub" style="font-style:normal">${words.length} words · ${newWords.length} new to you · ${grams.length} grammar point${grams.length === 1 ? '' : 's'}</div>
      ${newWords.length ? `<button class="chip primary" data-act="addall"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg> Add ${newWords.length} new word${newWords.length === 1 ? '' : 's'}</button>` : ''}
    </div>
    <div class="vg">
      <div class="vg-card"><div class="vg-h"><svg class="ic" aria-hidden="true"><use href="#i-tag"/></svg> Words</div><div class="vg-sub">matched against your deck — known vs new</div>${wordRows || '<div class="vg-sub">No content words found.</div>'}</div>
      <div class="vg-card"><div class="vg-h"><svg class="ic" aria-hidden="true"><use href="#i-book"/></svg> Grammar</div><div class="vg-sub">tap a point for the reference + practice</div>${gramRows || '<div class="vg-sub">No grammar points tagged.</div>'}</div>
    </div>`;
}

function grammarRefHtml() {
  const s = openSong;
  const id = grammarRef;
  const usedLines = s.lines.filter((l) => (l.grammar || []).includes(id));
  const lines = usedLines.map((l) => {
    return `<div class="gref-line jp">${l.furigana ? segmentsToRuby(l.furigana) : escapeHtml(l.text)}${l.en ? `<div class="gl-en">${escapeHtml(l.en)}</div>` : ''}
      <button class="xlink" data-act="savephrase" data-ord="${l.ordinal}" style="margin-top:6px"><svg class="ic" aria-hidden="true"><use href="#i-mic"/></svg> Save as a shadow phrase</button></div>`;
  }).join('');
  return `
    <div class="gref">
      <button class="st-back" data-act="mode" data-mode="mine" style="margin-bottom:10px"><svg class="ic" aria-hidden="true"><use href="#i-back"/></svg> back to ${escapeHtml(s.title)}</button>
      <div style="display:flex;align-items:center;gap:10px"><span class="gref-pat jp">${escapeHtml(grammarLabel(id))}</span><span class="lv ${LV_CLASS[grammarJlpt(id)] || ''}">${escapeHtml(grammarJlpt(id) || '')}</span></div>
      <div class="gref-h">Used in this song · ${usedLines.length} line${usedLines.length === 1 ? '' : 's'}</div>
      ${lines || '<div class="vg-sub">No lines.</div>'}
      <div class="gref-h">Practice it</div>
      <div><button class="xlink" data-act="browse-grammar" data-g="${escapeHtml(id)}"><svg class="ic" aria-hidden="true"><use href="#i-grid"/></svg> Browse example sentences using this</button></div>
    </div>`;
}

// ---- the YouTube player mount + synced highlight ----
function mountSongPlayer() {
  if (!openSong || !openSong.youtubeId) return;
  const el = document.getElementById('sgPlayer'); if (!el) return;
  mountPlayer(el, openSong.youtubeId, { onTime: highlightAt });
}
function highlightAt(sec) {
  if (!openSong || mode !== 'read') return;
  const ms = sec * 1000;
  let cur = -1;
  openSong.lines.forEach((l, i) => { if (l.clipStartMs != null && l.clipStartMs <= ms) cur = i; });
  document.querySelectorAll('#sgBody .lyric').forEach((el, i) => { el.classList.toggle('cur', i === cur); el.classList.toggle('past', i < cur); });
}

// ---- per-line replay: a timed YouTube slice, else a synth play of the line ----
function replayLine(ord, btn, e) {
  const l = openSong.lines[ord]; if (!l) return;
  const next = openSong.lines[ord + 1];
  if (l.clipStartMs != null && playSlice(l.clipStartMs / 1000, next && next.clipStartMs != null ? next.clipStartMs / 1000 : undefined)) return;
  playItem({ text: plainText(l.text) }, 'songs', btn, { cycle: cycleMod(e) });
}

// ============================ handlers ============================
async function onClick(e) {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const act = t.dataset.act;
  if (act === 'add') { view = 'add'; add = { lyrics: '', url: '', title: '', artist: '', analysis: null, busy: false, error: '' }; render(); return; }
  if (act === 'back') { view = 'library'; openSong = null; mode = 'read'; loadLibrary().then(render); render(); return; }
  if (act === 'signin') { document.getElementById('accountBtn').click(); return; }
  if (act === 'filter') { libFilter = t.dataset.filter; render(); return; }
  if (act === 'open') { await openById(t.dataset.id); return; }
  if (act === 'analyze' || act === 'reanalyze') { await runAnalyze(); return; }
  if (act === 'save') { await saveSong(); return; }
  if (act === 'mode') { mode = t.dataset.mode === 'mine' ? 'mine' : t.dataset.mode; if (mode !== 'grammar') grammarRef = null; render(); return; }
  if (act === 'grammar') { grammarRef = t.dataset.g; mode = 'grammar'; render(); return; }
  if (act === 'reveal') { const en = t.dataset.en || ''; t.classList.remove('hidden'); t.removeAttribute('data-act'); t.innerHTML = escapeHtml(en); return; }
  if (act === 'reveal-all') { document.querySelectorAll('#sgBody .l-en.hidden').forEach((el) => { el.classList.remove('hidden'); el.innerHTML = escapeHtml(el.dataset.en || ''); el.removeAttribute('data-act'); }); t.classList.toggle('on'); return; }
  if (act === 'furigana') { toggleFurigana(t); return; }
  if (act === 'replay') { replayLine(Number(t.dataset.ord), t.closest('.speak-btn'), e); return; }
  if (act === 'addword') { addOneWord(t.dataset.lemma); return; }
  if (act === 'addall') { addAllNew(); return; }
  if (act === 'savephrase') { await savePhrase(Number(t.dataset.ord)); return; }
  if (act === 'browse-grammar') { goBrowseGrammar(t.dataset.g); return; }
}

// Local furigana toggle for Read (independent of the global setting): flip <rt> visibility on the
// lyric block. Uses the global data-furigana attribute scoped here via a class on the lyrics list.
function toggleFurigana(btn) {
  const lyr = document.querySelector('#sgBody .lyrics');
  if (lyr) lyr.classList.toggle('furi-off');
  btn.classList.toggle('on');
}

async function openById(id) {
  try {
    const s = await loadSong(id);
    if (!s) return;
    openSong = s; view = 'song'; mode = 'read'; grammarRef = null;
    render();
  } catch (e) { /* offline / gone — stay on library */ }
}

async function runAnalyze() {
  // Capture the typed inputs BEFORE re-rendering (render() rebuilds the textarea from add.lyrics).
  const lyricsEl = document.getElementById('sgLyrics'); if (lyricsEl) add.lyrics = lyricsEl.value;
  const urlEl = document.getElementById('sgUrl'); if (urlEl) add.url = urlEl.value;
  add.busy = true; add.error = ''; render();
  add.youtubeId = parseYouTubeId(add.url);
  // oEmbed title/artist auto-fill (best-effort) before analysis.
  if (add.youtubeId && !add.title) {
    try { const oe = await api('/v1/songs/oembed?url=' + encodeURIComponent(add.url)); if (oe) { add.title = oe.title || ''; add.artist = oe.author || ''; } } catch (e) { /* */ }
  }
  try {
    const r = await api('/v1/songs/analyze', { method: 'POST', body: { lyrics: add.lyrics, title: add.title || undefined, artist: add.artist || undefined } });
    add.analysis = r; add.busy = false; render();
  } catch (err) {
    add.busy = false;
    add.error = err.status === 503
      ? 'Lyrics analysis isn’t available on this server yet. (Try again once it’s enabled.)'
      : (err.status === 400 ? 'Paste some lyrics first.' : 'Analysis failed — please try again.');
    render();
  }
}

async function saveSong() {
  if (!add.analysis) return;
  add.busy = true; render();
  const id = 'usr-' + crypto.randomUUID();
  const lines = add.analysis.lines.map((l) => ({
    text: l.text, furigana: l.furigana, en: l.en || null, grammar: l.grammar || [],
    tokens: (l.tokens && l.tokens.length) ? l.tokens : null,
  }));
  try {
    const r = await api('/v1/songs', { method: 'POST', body: { id, title: add.title || 'Untitled', artist: add.artist || null, youtubeId: add.youtubeId || null, lines }, retry: true });
    await loadLibrary();
    if (r && r.song) { openSong = r.song; view = 'song'; mode = 'read'; }
    else view = 'library';
    add = { lyrics: '', url: '', title: '', artist: '', analysis: null, busy: false, error: '' };
    render();
  } catch (err) {
    add.busy = false; add.error = 'Save failed — please try again.'; render();
  }
}

function addOneWord(lemma) {
  const w = songWords(openSong.lines).find((x) => x.lemma === lemma);
  if (!w) return;
  const n = activateSongWords(openSong.id, openSong.title, [w]);
  if (n) render(); // re-render Mine so the row flips to KNOWN-ish (now in deck)
}
function addAllNew() {
  const k = known();
  const dk = new Set(state.DATA.map((v) => v.jp));
  const news = songWords(openSong.lines).filter((x) => !k.has(x.lemma) && !dk.has(x.lemma));
  activateSongWords(openSong.id, openSong.title, news);
  render();
}

// Save a lyric line as a private 独り言 Self-Talk shadow phrase (reuses the sentence store; no new
// SRS card type). The line already carries furigana + grammar + an English.
async function savePhrase(ord) {
  if (!account) { document.getElementById('accountBtn').click(); return; }
  const l = openSong.lines[ord]; if (!l) return;
  const extId = 'usr-' + crypto.randomUUID();
  const body = {
    id: extId, text: l.text, furigana: l.furigana || null,
    translations: l.en ? { en: l.en } : undefined,
    tags: (l.grammar && l.grammar.length) ? { grammar: l.grammar } : undefined,
    link: { owner_type: 'selftalk' },
  };
  try { await api('/v1/sentences', { method: 'POST', body, retry: true }); flash('Saved to 独り言 Self-Talk'); }
  catch (e) { flash('Could not save the phrase'); }
}

function goBrowseGrammar(id) {
  // Deep-link into Browse filtered to this grammar point (cross-link to example sentences).
  document.querySelector('.tab[data-tab="browse"]').click();
  // The Browse grammar facet is its own chip row; selecting it programmatically is a follow-up —
  // for now this lands the user on Browse where the グラマー chip for this id is available.
}

function flash(msg) {
  const el = document.getElementById('syncStatus'); if (!el) return;
  el.textContent = msg; setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 2200);
}

// ============================ lifecycle ============================
export function initSongs() {
  const el = body(); if (!el) return;
  if (!el._sgWired) { el._sgWired = true; el.addEventListener('click', onClick); wireWordTaps(el); }
}
export function onSongsHidden() { destroyPlayer(); }
