// 歌/Songs — Edit + Delete one of the viewer's OWN songs (owner-scoped server-side: the PUT/DELETE
// 404 a starter or another account's song, so the ctx-row buttons render only for s.custom). The
// inline title/artist form in the hero is driven by the S.editing DRAFT ({title, artist, error}) —
// the draft, not the song, backs the inputs, so a failed save re-renders with what the user typed
// instead of silently discarding it. Part of the features/songs/ package; shared mutable state in
// ./state.js. Status pills go through cloud-core's setSyncStatus (the one #syncStatus writer).

import { setSyncStatus } from '../cloud-core.js';
import { exitSpeakingMode } from '../record-compare.js';
import { S } from './state.js';
import { updateSong, removeSong } from './library.js';
import { render, showLibrary, refreshLibrary } from './index.js';

// Open the inline edit form, seeding the draft from the song's current metadata.
export function startEdit() {
  const s = S.openSong; if (!s) return;
  S.editing = { title: s.title, artist: s.artist || '', error: '' };
  render();
}

export function cancelEdit() { S.editing = null; render(); }

// Persist the draft. On success: sync S.openSong, close the form, refresh the library grid (the
// card shows the new title). On ANY failure (network, offline, server refusal): keep the form open
// with the typed draft + an inline error, so a flaky connection can't eat the user's input.
export async function saveEdit(draft) {
  const s = S.openSong; if (!s || !S.editing) return;
  S.editing = { ...S.editing, ...draft };
  const title = (S.editing.title || '').trim();
  const artist = (S.editing.artist || '').trim();
  if (!title) { S.editing.error = 'Title can’t be empty'; render(); return; }
  try {
    const updated = await updateSong(s.id, { title, artist: artist || null });
    if (S.openSong !== s) return;   // navigated away while the PUT was in flight — drop the result
    if (!updated) { S.editing.error = 'Couldn’t save changes — try again.'; render(); return; }
    s.title = updated.title; s.artist = updated.artist;
    S.editing = null;
    setSyncStatus('✓ saved');
    refreshLibrary();
  } catch (e) {
    if (S.openSong !== s || !S.editing) return;
    S.editing.error = 'Couldn’t save changes — try again.'; render();
  }
}

// Delete the open song (cascades its line rows server-side) after a confirm, then return to the
// library. confirmFn is injectable for tests; the default is the browser dialog.
export async function deleteSong(confirmFn) {
  const s = S.openSong; if (!s) return;
  const confirmed = (confirmFn || ((m) => window.confirm(m)))(`Delete “${s.title}”? This removes the song and its lines for good.`);
  if (!confirmed) return;
  try {
    if (await removeSong(s.id)) {
      exitSpeakingMode();
      setSyncStatus('✓ deleted');
      showLibrary();
    } else setSyncStatus('⚠ couldn’t delete');
  } catch (e) { setSyncStatus('⚠ couldn’t delete'); }
}
