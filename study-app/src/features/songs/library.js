// 歌/Songs — Library: the read-through cache + server fetch + the library grid (public starters +
// the viewer's own private songs, with coverage / level / shadow-progress badges per card). Part of
// the features/songs/ package; shared mutable state in ./state.js. See REFACTOR_FOLLOWUPS.md "S".

import { api } from '../cloud-core.js';
import { state } from '../../state.js';
import { escapeHtml, knownHeadwords, coverage, songLevel, songProgress } from '../../core/index.js';
import { createReadThroughResource } from '../../persistence/resource.js';
import { S, CACHE_KEY, LV_CLASS } from './state.js';
import { progressFor } from './progress.js';

// ---- read-through resource: fetch the library (public starters + the viewer's own private songs)
// into S.library, write-through to the cache, and fall back to the cache on a failed/offline open so
// the grid still paints. Resolves true on a successful network refresh (callers ignore it). ----
const libraryResource = createReadThroughResource({
  cacheKey: CACHE_KEY,
  fetch: () => api('/v1/songs').then((r) => (r && r.songs) || []),
  current: () => S.library,
  apply: (v) => { S.library = v; },
});

export function loadLibrary() { return libraryResource.refresh(); }
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
    section: (s.link && s.link.role) || null, // stanza label (Verse/Chorus/…) on a stanza's first line
  };
}
// Fetch one assembled song by ext_id, flattening its server lines into the render shape; null if
// gone/unauthorized. The caller (openById) assigns S.openSong.
export async function loadSong(id) {
  const r = await api('/v1/songs/' + encodeURIComponent(id));
  const s = r && r.song;
  if (s) s.lines = (s.lines || []).map(normalizeLine);
  return s;
}

// Edit one of the viewer's OWN songs' metadata (title/artist). Owner-scoped server-side (PUT 404s a
// starter / another account's song). Returns the updated song meta, or null on failure.
export async function updateSong(id, fields) {
  const r = await api('/v1/songs/' + encodeURIComponent(id), { method: 'PUT', body: fields });
  return (r && r.song) || null;
}

// Delete one of the viewer's OWN songs (cascades its line rows). Owner-scoped server-side. Returns
// true on success.
export async function removeSong(id) {
  const r = await api('/v1/songs/' + encodeURIComponent(id), { method: 'DELETE' });
  return !!(r && r.ok);
}

// ---- the known-headword set (recomputed per render; cheap) ----
export function known() { return knownHeadwords(state.store.cards, state.DATA); }

// ---- Library grid ----
export function libraryHtml() {
  const k = known();
  const shown = S.library.filter((s) => S.libFilter === 'all' || (S.libFilter === 'mine' ? s.custom : !s.custom));
  const cards = shown.map((s) => songCardHtml(s, k)).join('');
  return `
    <div class="sg-intro">
      <div class="marker"><div class="idx">06<span class="slash"> / 07</span></div><div class="ttl jp-min">歌</div><div class="en">Songs</div><div class="rule"></div></div>
      <p class="st-lede">Study real songs as listening, reading, and speaking practice. Add your own (paste the lyrics, link the video) or start from the bundled set.</p>
    </div>
    <div class="toolbar sg-toolbar">
      <button class="chip primary" data-act="add"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg> Add a song</button>
      <span style="flex:1"></span>
      <span class="filter-label">Show</span>
      <div class="chips" role="radiogroup" aria-label="Show songs">
        <button class="chip sg-filter${S.libFilter === 'all' ? ' active' : ''}" data-act="filter" data-filter="all">All</button>
        <button class="chip sg-filter${S.libFilter === 'mine' ? ' active' : ''}" data-act="filter" data-filter="mine">Mine</button>
        <button class="chip sg-filter${S.libFilter === 'starter' ? ' active' : ''}" data-act="filter" data-filter="starter">Starter</button>
      </div>
    </div>
    ${shown.length ? `<div class="song-grid">${cards}</div>`
      : `<p class="sg-empty">${S.library.length ? 'No songs match this filter.' : 'No songs yet — add one to get started.'}</p>`}`;
}

function songCardHtml(s, k) {
  const cov = coverage(s.words, k);
  const prog = songProgress(progressFor(s.id), s.lineCount);   // ring = shadowed-lines % (the practice signal); coverage stays in the bar below
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
        <span class="sc-ring"><span class="ring" style="--p:${prog.pct}%" title="${prog.shadowed} of ${s.lineCount} line${s.lineCount === 1 ? '' : 's'} shadowed"><span>${prog.pct}</span></span><span class="sc-ring-cap">shadowed</span></span>
      </span>
      <span class="sc-cov"><span class="sc-cov-top"><span>you know</span><b>${cov.pct}%</b></span><span class="cov-bar"><i class="cov-fill" style="width:${cov.pct}%"></i></span></span>
      <span class="sc-meta">${lvlBadge}${src}${timed}</span>
    </button>`;
}
