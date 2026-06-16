// 歌/Songs — the `songs` progress blob (PROGRESS ONLY; song content is server-authoritative) + the
// Source:歌 vocab activation + the shared "spoke today" take-saved hook. Part of the features/songs/
// package; shared mutable state in ./state.js. See REFACTOR_FOLLOWUPS.md "Workstream S".

import { state } from '../../state.js';
import { localDay } from '../../config.js';
import { parseSongLineKey, songWords, songCardKey, buildSongCard, applyPractice } from '../../core/index.js';
import { loadCustom, saveCustom } from '../../persistence/custom.js';
import { saveSelftalk } from '../../persistence/selftalk.js';
import { saveSongs } from '../../persistence/songs.js';
import { rebuildData, refreshAfterVerbChange } from '../custom-cards.js';
import { S } from './state.js';
import { known } from './library.js';
import { render } from './index.js';

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
    const songKey = songCardKey(songExtId, w.lemma);
    if (existingKeys.has(songKey)) continue;
    if (existingJp.has(w.lemma)) continue; // already in the deck — don't duplicate
    cs.seq = (cs.seq || 100) + 1;
    cs.verbs.push(buildSongCard({ songExtId, songTitle, word: w, rank: cs.seq }));
    existingKeys.add(songKey); existingJp.add(w.lemma); added++;
  }
  if (added) { saveCustom(cs); rebuildData(); refreshAfterVerbChange(); }
  return added;
}

// Activate one mined word into the deck (a Source:歌 custom card) + re-render Mine so its row flips.
export function addOneWord(lemma) {
  const w = songWords(S.openSong.lines).find((x) => x.lemma === lemma);
  if (!w) return;
  const n = activateSongWords(S.openSong.id, S.openSong.title, [w]);
  if (n) render(); // re-render Mine so the row flips to KNOWN-ish (now in deck)
}
// Activate every new (not-known, not-already-in-deck) word from the open song in one batch.
export function addAllNew() {
  const k = known();
  const dk = new Set(state.DATA.map((v) => v.jp));
  const news = songWords(S.openSong.lines).filter((x) => !k.has(x.lemma) && !dk.has(x.lemma));
  activateSongWords(S.openSong.id, S.openSong.title, news);
  render();
}

// A saved Shadow take → the shared "spoke today" day-streak (reuses Self-Talk's practice signal — one
// speaking streak across both surfaces) + the songs progress blob (the shadowed-line → ring signal).
export function onSongTakeSaved(itemKey) {
  if (state.selftalkStore) {
    state.selftalkStore.practice = applyPractice(state.selftalkStore.practice, itemKey, localDay());
    saveSelftalk();   // persists + schedules the 'selftalk' blob push (the streak is shared)
  }
  markShadowed(itemKey);
}

// ---- the `songs` progress blob (PROGRESS ONLY — song content is server-authoritative) ----
// Read-only entry lookup for render (does NOT create a row); get-or-create for writes.
export function progressFor(extId) { return state.songsStore.progress[extId]; }
function songEntry(extId) {
  const p = state.songsStore.progress;
  if (!p[extId]) p[extId] = { starred: [], shadowed: [] };
  return p[extId];
}
// Record a shadowed line (feeds the library progress ring). itemKey = songLineKey(extId, ord) =
// "<extId>:<ord>", decoded by the pure parseSongLineKey. Idempotent per ordinal. The day-streak
// ("I practiced") is marked separately in onSongTakeSaved.
function markShadowed(itemKey) {
  const parsed = parseSongLineKey(itemKey);
  if (!parsed) return;
  const { extId, ordinal } = parsed;
  const entry = songEntry(extId);
  if (entry.shadowed.includes(ordinal)) return;   // already recorded — no needless push
  entry.shadowed.push(ordinal); entry.shadowed.sort((a, b) => a - b);
  saveSongs();
}
// Toggle a per-line star (a bookmark; shown in Read). Targeted DOM update so the player stays mounted.
export function toggleStar(ord, btn) {
  if (!S.openSong || !Number.isInteger(ord)) return;
  const entry = songEntry(S.openSong.id);
  const idx = entry.starred.indexOf(ord);
  if (idx >= 0) entry.starred.splice(idx, 1);
  else { entry.starred.push(ord); entry.starred.sort((a, b) => a - b); }
  saveSongs();
  const on = entry.starred.includes(ord);
  if (btn) { btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', String(on)); btn.setAttribute('aria-label', on ? 'Unstar line' : 'Star line'); }
}
// The mode to (re)open a song in: the saved view cursor (read/listen/shadow/mine), default Read.
export function restoreMode(extId) {
  const m = (progressFor(extId) || {}).lastMode;
  return (m === 'listen' || m === 'shadow' || m === 'mine') ? m : 'read';
}
// Persist the resume cursor on a mode switch (no-op if unchanged → no needless push).
export function noteMode(m) {
  if (!S.openSong) return;
  const entry = songEntry(S.openSong.id);
  if (entry.lastMode === m) return;
  entry.lastMode = m;
  saveSongs();
}
