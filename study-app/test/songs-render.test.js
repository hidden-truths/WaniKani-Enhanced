// Integration test for the 歌/Songs package's render + navigation GLUE (src/features/songs/*) — the
// layer the pure core/songs.js tests can't reach and `bun run build` can't catch (a missed export or
// a bare identifier is a runtime ReferenceError). Imports the real package and DRIVES it the way the
// app does — initSongs' once-attached delegated click on #sgBody, the ACTIONS dispatcher, openById,
// and the edit/delete flows in songs/edit.js — under happy-dom, with the engine / audio / YouTube /
// network / persistence mocked. Covers the resilience contracts specifically: the S.nav epoch drops
// a stale async open, and a failed edit-save keeps the user's typed draft instead of discarding it.
import { test, expect, beforeEach, afterEach, vi } from 'vitest';

// --- mock the side-effecting collaborators (engine, speaking bar, audio, YouTube, network, stores) ---
const ctx = vi.hoisted(() => ({ account: null, api: null, sync: null }));
vi.mock('../src/features/record-compare.js', () => ({
  RECORD_SUPPORTED: false,
  isSpeakingMode: () => false,
  exitSpeakingMode: () => {},
  recordControlHtml: () => '',
  wireRecordCompare: () => {},
  paintCompareWaveforms: () => {},
  setOnTakeSaved: () => {},
}));
vi.mock('../src/features/speaking-bar.js', () => ({
  createSpeakingBar: () => ({ mount: () => {}, onToggle: () => {} }),
  clearSpeakingBar: () => {},
  releaseMicIfHidden: () => false,
}));
vi.mock('../src/features/word-lookup.js', () => ({ wireWordTaps: () => {} }));
vi.mock('../src/features/browse.js', () => ({ openBrowseGrammar: () => {} }));   // mine.js's grammar deep-link target (browse drags settings-store's eval-time localStorage read)
vi.mock('../src/features/audio.js', () => ({ playItem: () => {}, cycleMod: () => false }));
vi.mock('../src/features/songs-youtube.js', () => ({
  mountPlayer: async () => {}, destroyPlayer: () => {}, playSlice: () => {},
}));
vi.mock('../src/features/cloud-core.js', () => ({
  get account() { return ctx.account; },
  api: (...args) => ctx.api(...args),
  setSyncStatus: (...args) => ctx.sync(...args),
}));
vi.mock('../src/features/custom-cards.js', () => ({ rebuildData: () => {}, refreshAfterVerbChange: () => {} }));
vi.mock('../src/persistence/songs.js', () => ({ loadSongs: () => {}, saveSongs: () => {} }));
vi.mock('../src/persistence/selftalk.js', () => ({ saveSelftalk: () => {} }));
vi.mock('../src/persistence/custom.js', () => ({ loadCustom: () => ({ seq: 100, verbs: [] }), saveCustom: () => {} }));

import { state } from '../src/state.js';
import { S } from '../src/features/songs/state.js';
import * as pkg from '../src/features/songs.js';
import { saveEdit } from '../src/features/songs/edit.js';

// --- fixtures: the server shapes (library summary + one assembled song) ---
const LIB = {
  songs: [
    { id: 'usr-1', title: '夜に駆ける', artist: 'YOASOBI', custom: true, lineCount: 2, timedCount: 2, words: [] },
    { id: 'st-1', title: '上を向いて歩こう', artist: '坂本九', custom: false, lineCount: 3, timedCount: 0, words: [] },
  ],
};
// GET /v1/songs/{id} returns AssembledSentence lines — normalizeLine must flatten these.
const assembledLine = (text, en) => ({
  text, furigana: null,
  translations: { en }, tags: { grammar: [] }, annotation: { tokens: [] },
  link: { clip_start_ms: 1200, role: null },
});
const SONG = {
  id: 'usr-1', title: '夜に駆ける', artist: 'YOASOBI', youtubeId: null, custom: true,
  lines: [assembledLine('走り出す', 'Start running'), assembledLine('君と二人', 'The two of us')],
};
// A routes-map api mock: exact "METHOD path" keys, values are fn(opts) → response (may throw/defer).
function apiRoutes(routes) {
  return vi.fn(async (path, opts = {}) => {
    const key = `${(opts.method || 'GET')} ${path}`;
    if (!(key in routes)) throw new Error(`unmocked api call: ${key}`);
    return routes[key](opts);
  });
}

const body = () => document.getElementById('sgBody').innerHTML;
const click = (sel) => {
  const el = document.querySelector(sel);
  expect(el, `expected a clickable ${sel}`).toBeTruthy();
  el.click();
};
// Drain the microtask chain behind a delegated async handler (api resolve → state → render).
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

beforeEach(() => {
  const store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k), clear: () => store.clear(),
  });
  document.body.innerHTML = `
    <div id="sgBody"></div><div id="panel-songs" class="active"></div>
    <div id="navExtra"></div><div id="syncStatus"></div><button id="accountBtn"></button>`;
  ctx.account = { id: 1, email: 'dev@example.com' };
  ctx.sync = vi.fn();
  ctx.api = apiRoutes({
    'GET /v1/songs': () => LIB,
    'GET /v1/songs/usr-1': () => ({ song: structuredClone(SONG) }),
  });
  // Reset the shared view-state + the app stores the package reads.
  Object.assign(S, {
    loaded: false, library: [], libFilter: 'all', view: 'library', openSong: null, mode: 'read',
    videoOn: false, grammarRef: null, editing: null, nav: 0, listen: null, recordingsLoaded: false,
    add: { lyrics: '', url: '', title: '', artist: '', analysis: null, busy: false, error: '' },
  });
  state.DATA = [];
  state.BUILTIN_RANK_BY_JP = {};
  state.store = { cards: {} };
  state.songsStore = { progress: {} };
  state.selftalkStore = { practice: {} };
});
afterEach(() => { vi.unstubAllGlobals(); });

test('the package barrel exports the public API main.js + cloud.js consume', () => {
  for (const name of ['initSongs', 'renderSongs', 'onSongsHidden']) {
    expect(typeof pkg[name], name).toBe('function');
  }
});

test('renderSongs paints the library grid (both sources, badges) and the Mine filter narrows it', async () => {
  pkg.initSongs();
  pkg.renderSongs();
  await flush();
  expect(body()).toContain('夜に駆ける');
  expect(body()).toContain('上を向いて歩こう');
  expect(body()).toContain('src-mine');
  expect(body()).toContain('src-starter');
  click('[data-act="filter"][data-filter="mine"]');
  expect(body()).toContain('夜に駆ける');
  expect(body()).not.toContain('上を向いて歩こう');
});

test('opening a song flattens the AssembledSentence lines (normalizeLine) and renders the song view', async () => {
  pkg.initSongs();
  pkg.renderSongs();
  await flush();
  click('[data-act="open"][data-id="usr-1"]');
  await flush();
  expect(S.view).toBe('song');
  expect(S.openSong.lines[0]).toMatchObject({ ordinal: 0, text: '走り出す', en: 'Start running', clipStartMs: 1200 });
  expect(body()).toContain('song-title');           // the hero
  expect(body()).toContain('data-act="mode"');      // the mode tabs
  expect(body()).toContain('走り出す');               // Read renders the lyric lines
  expect(body()).toContain('data-en="Start running"'); // EN hidden behind tap-to-reveal
});

test('a stale open resolving after the user navigated on is DROPPED (the S.nav epoch)', async () => {
  let releaseSong;
  ctx.api = apiRoutes({
    'GET /v1/songs': () => LIB,
    'GET /v1/songs/usr-1': () => new Promise((res) => { releaseSong = () => res({ song: structuredClone(SONG) }); }),
  });
  pkg.initSongs();
  pkg.renderSongs();
  await flush();
  click('[data-act="open"][data-id="usr-1"]');   // slow GET in flight…
  await flush();
  click('[data-act="add"]');                      // …user moves on to the Add screen
  expect(S.view).toBe('add');
  releaseSong();                                  // the stale GET finally lands
  await flush();
  expect(S.view).toBe('add');                     // and is dropped — no clobber
  expect(S.openSong).toBeNull();
});

test('edit: the form is draft-backed, and a successful save PUTs, updates the hero, and closes', async () => {
  pkg.initSongs();
  pkg.renderSongs();
  await flush();
  click('[data-act="open"][data-id="usr-1"]');
  await flush();
  ctx.api = apiRoutes({
    'GET /v1/songs': () => LIB,
    'PUT /v1/songs/usr-1': (opts) => ({ song: { ...SONG, title: opts.body.title, artist: opts.body.artist } }),
  });
  click('[data-act="songedit"]');
  expect(S.editing).toMatchObject({ title: '夜に駆ける', artist: 'YOASOBI' });
  document.getElementById('sgEditTitle').value = '夜に駆ける (inst.)';
  document.getElementById('sgEditArtist').value = '';
  click('[data-act="songeditsave"]');
  await flush();
  expect(ctx.api).toHaveBeenCalledWith('/v1/songs/usr-1', expect.objectContaining({
    method: 'PUT', body: { title: '夜に駆ける (inst.)', artist: null },
  }));
  expect(S.editing).toBeNull();
  expect(S.openSong.title).toBe('夜に駆ける (inst.)');
  expect(body()).toContain('夜に駆ける (inst.)');
  expect(ctx.sync).toHaveBeenCalledWith('✓ saved');
});

test('edit: a FAILED save keeps the form open with the typed draft + an inline error', async () => {
  pkg.initSongs();
  pkg.renderSongs();
  await flush();
  click('[data-act="open"][data-id="usr-1"]');
  await flush();
  ctx.api = apiRoutes({
    'GET /v1/songs': () => LIB,
    'PUT /v1/songs/usr-1': () => { throw new Error('offline'); },
  });
  click('[data-act="songedit"]');
  document.getElementById('sgEditTitle').value = 'タイトル直し';
  click('[data-act="songeditsave"]');
  await flush();
  expect(S.view).toBe('song');                            // still on the song, still editing
  expect(S.editing).toMatchObject({ title: 'タイトル直し' }); // the typed draft survived
  expect(S.editing.error).toMatch(/save/i);
  expect(document.getElementById('sgEditTitle').value).toBe('タイトル直し');
  expect(body()).toContain('sg-err');
  expect(S.openSong.title).toBe('夜に駆ける');              // the song itself is untouched
});

test('edit: an empty title is rejected locally without any network call', async () => {
  pkg.initSongs();
  pkg.renderSongs();
  await flush();
  click('[data-act="open"][data-id="usr-1"]');
  await flush();
  const put = vi.fn();
  ctx.api = apiRoutes({ 'GET /v1/songs': () => LIB, 'PUT /v1/songs/usr-1': put });
  click('[data-act="songedit"]');
  await saveEdit({ title: '   ', artist: '' });
  expect(put).not.toHaveBeenCalled();
  expect(S.editing.error).toMatch(/empty/i);
});

test('delete: confirm → DELETE + back to the library; cancel → nothing happens', async () => {
  pkg.initSongs();
  pkg.renderSongs();
  await flush();
  click('[data-act="open"][data-id="usr-1"]');
  await flush();
  const del = vi.fn(() => ({ ok: true }));
  ctx.api = apiRoutes({ 'GET /v1/songs': () => LIB, 'DELETE /v1/songs/usr-1': del });
  // Cancelled confirm: no call, still on the song.
  vi.stubGlobal('confirm', vi.fn(() => false));
  click('[data-act="songdelete"]');
  await flush();
  expect(del).not.toHaveBeenCalled();
  expect(S.view).toBe('song');
  // Confirmed: DELETE fires, the view returns to the library.
  vi.stubGlobal('confirm', vi.fn(() => true));
  click('[data-act="songdelete"]');
  await flush();
  expect(del).toHaveBeenCalledTimes(1);
  expect(S.view).toBe('library');
  expect(S.openSong).toBeNull();
  expect(ctx.sync).toHaveBeenCalledWith('✓ deleted');
});

test('the Add screen gates on account: anon sees the sign-in banner, not the paste form', async () => {
  ctx.account = null;
  pkg.initSongs();
  pkg.renderSongs();
  await flush();
  click('[data-act="add"]');
  expect(S.view).toBe('add');
  expect(body()).toContain('Sign in to add a song');
  expect(document.getElementById('sgLyrics')).toBeNull();
});
