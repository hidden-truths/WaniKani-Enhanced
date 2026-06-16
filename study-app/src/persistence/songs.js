// 歌 SONGS progress storage — per-song PROGRESS ONLY (starred/shadowed line ordinals + the last
// view cursor), in ONE localStorage blob, synced under the 'songs' app key. Song CONTENT is
// server-authoritative (the sentence store); this blob never holds line text/furigana/timing —
// the same split as Self-Talk's {practice}-only blob (persistence/selftalk.js, which this mirrors).
// Mutate state.songsStore in memory; saveSongsLocal() persists instantly; saveSongs() additionally
// schedules a debounced cloud push via the sync bus.
//
//   state.songsStore = {
//     progress: {
//       "<song ext_id>": { starred:[ord…], shadowed:[ord…], lastMode?:'read'|'listen'|'shadow'|'mine' },
//       …
//     },
//   }
import { state } from '../state.js';
import { sync } from '../sync-bus.js';

const KEY = 'jpverbs_songs';
// The modes worth resuming into (Read/Listen/Shadow/Mine). 'grammar' is a sub-view of Mine and not
// a resume target, so it's excluded — a restored lastMode is validated against this set.
const RESUME_MODES = new Set(['read', 'listen', 'shadow', 'mine']);

export function emptySongs() { return { progress: {} }; }

// Normalize an arbitrary parsed blob into the store shape (tolerant of partial / legacy / cloud
// data). Pure — returns a fresh object; keeps only integer ordinals + a known lastMode per song.
export function normalizeSongs(o) {
  const base = emptySongs();
  if (!o || typeof o !== 'object') return base;
  const prog = o.progress && typeof o.progress === 'object' ? o.progress : {};
  const progress = {};
  for (const id of Object.keys(prog)) {
    const e = prog[id];
    if (!e || typeof e !== 'object') continue;
    const ords = (a) => (Array.isArray(a) ? [...new Set(a.filter(Number.isInteger))].sort((p, q) => p - q) : []);
    const entry = { starred: ords(e.starred), shadowed: ords(e.shadowed) };
    if (typeof e.lastMode === 'string' && RESUME_MODES.has(e.lastMode)) entry.lastMode = e.lastMode;
    progress[id] = entry;
  }
  return { progress };
}

// Hydrate state.songsStore from localStorage. Call once at boot, before any reader.
export function loadSongs() {
  let o = null;
  try { o = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  state.songsStore = normalizeSongs(o);
  return state.songsStore;
}

// Persist to localStorage only (instant, offline-safe). saveSongs() additionally schedules the
// debounced cloud push when signed in (via the sync bus → cloud.js). Splitting them lets
// cloud-hydration write localStorage WITHOUT re-pushing the same bytes back.
export function saveSongsLocal() {
  try { localStorage.setItem(KEY, JSON.stringify(state.songsStore)); } catch (e) {}
}
export function saveSongs() {
  saveSongsLocal();
  sync.songs();
}
