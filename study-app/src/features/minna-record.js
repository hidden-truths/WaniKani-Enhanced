// みんなの日本語 RECORD-AND-COMPARE (Phase 2). The learner records themselves saying a
// vocab word / conversation line and compares it to the cached native audio. This module
// owns the MediaRecorder capture flow, upload, the per-item take list, and gated playback
// of a take. The native-audio compare player + conversation-line clips are layered on in a
// later commit; this commit ships capture + your-own-take playback.
//
// Recordings are PRIVATE on the server (served only via the owner-gated
// /v1/minna/recordings/{id}); like the native audio, take playback uses one reused
// <audio crossOrigin='use-credentials'> so the session cookie authorizes it cross-origin.
import { API_BASE } from '../config.js';
import { account, api, setSyncStatus } from './cloud-core.js';
import { settings } from '../settings-store.js';
import { escapeHtml, clampKeep, formatDuration } from '../core/index.js';

// Capability gates. Recording needs getUserMedia + MediaRecorder; both are absent over
// insecure origins / old browsers. When unavailable we degrade to a quiet hint.
export const RECORD_SUPPORTED = !!(typeof navigator !== 'undefined' && navigator.mediaDevices
  && navigator.mediaDevices.getUserMedia && typeof window !== 'undefined' && window.MediaRecorder);

// Prefer opus-in-webm; fall back to whatever the browser supports (Safari → mp4). The
// server strips codec params and validates the base type (audio/webm|mp4|ogg|mpeg).
function pickMime() {
  if (!RECORD_SUPPORTED || !MediaRecorder.isTypeSupported) return '';
  for (const c of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

// ---------- take cache (per lesson, fetched once) ----------
// recCache[lesson] = array of takes {id,lesson,itemKey,durationMs,createdAt} newest-first.
const recCache = {};
export async function loadLessonRecordings(lesson) {
  if (!account) { recCache[lesson] = []; return []; }
  try {
    const r = await api('/v1/minna/recordings?lesson=' + lesson);
    recCache[lesson] = (r && r.recordings) || [];
  } catch (e) { recCache[lesson] = recCache[lesson] || []; }
  return recCache[lesson];
}
function takesFor(lesson, itemKey) {
  return (recCache[lesson] || []).filter(t => t.itemKey === itemKey);
}
// Replace one item's takes in the cache (after upload/delete) without a refetch.
function setTakes(lesson, itemKey, takes) {
  const others = (recCache[lesson] || []).filter(t => t.itemKey !== itemKey);
  recCache[lesson] = others.concat(takes).sort((a, b) => b.createdAt - a.createdAt);
}

// ---------- gated playback of a saved take ----------
let takeAudioEl = null, takePlayingBtn = null;
function playTake(id, btn) {
  if (!takeAudioEl) { takeAudioEl = new Audio(); takeAudioEl.crossOrigin = 'use-credentials'; }
  if (btn && btn === takePlayingBtn && !takeAudioEl.paused) { takeAudioEl.pause(); btn.classList.remove('playing'); takePlayingBtn = null; return; }
  if (takePlayingBtn) takePlayingBtn.classList.remove('playing');
  takeAudioEl.src = API_BASE + '/v1/minna/recordings/' + id;
  takePlayingBtn = btn || null; if (btn) btn.classList.add('playing');
  takeAudioEl.onended = takeAudioEl.onerror = () => { if (takePlayingBtn) { takePlayingBtn.classList.remove('playing'); takePlayingBtn = null; } };
  takeAudioEl.play().catch(() => { if (btn) btn.classList.remove('playing'); takePlayingBtn = null; });
}

// ---------- HTML ----------
// One control per recordable item (a vocab word or a conversation line). `nativeSrc` is the
// item's native-audio vnjpclub path (used by the compare player in a later commit). The
// control re-renders its own innerHTML after capture/delete; lesson + itemKey live on the
// dataset so the delegated handlers can find them.
export function recordControlHtml(lesson, itemKey, nativeSrc) {
  return `<div class="rec-control" data-lesson="${lesson}" data-itemkey="${escapeHtml(itemKey)}"${nativeSrc ? ` data-native="${escapeHtml(nativeSrc)}"` : ''}>${recordControlInner(lesson, itemKey)}</div>`;
}
function recordControlInner(lesson, itemKey) {
  if (!RECORD_SUPPORTED) return `<span class="rec-unsupported">Recording needs a modern browser + microphone.</span>`;
  return `<button class="rec-btn" type="button" data-rec-toggle aria-label="Record yourself"><svg class="ic" aria-hidden="true"><use href="#i-mic"/></svg><span class="rec-label">Record</span></button>
    <div class="rec-takes">${takesHtml(lesson, itemKey)}</div>`;
}
function takesHtml(lesson, itemKey) {
  const takes = takesFor(lesson, itemKey);
  if (!takes.length) return '';
  return takes.map(t => `<span class="rec-take">
      <button class="rec-take-play" type="button" data-take-play="${t.id}" aria-label="Play your recording"><svg class="ic" aria-hidden="true"><use href="#i-play"/></svg>${escapeHtml(formatDuration(t.durationMs)) || 'take'}</button>
      <button class="rec-take-del" type="button" data-take-del="${t.id}" aria-label="Delete this recording"><svg class="ic" aria-hidden="true"><use href="#i-trash"/></svg></button>
    </span>`).join('');
}

// ---------- capture state (one active recording at a time) ----------
let active = null;   // { control, recorder, stream, chunks, mime, startedAt }

function resetControl(control) {
  const lesson = Number(control.dataset.lesson), itemKey = control.dataset.itemkey;
  control.innerHTML = recordControlInner(lesson, itemKey);
}

async function startRecording(control) {
  if (active) stopStream(active);   // never run two at once
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { setSyncStatus('⚠ microphone blocked'); return; }
  const mime = pickMime();
  const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' });
    const durationMs = Date.now() - active.startedAt;
    stopStream(active);
    active = null;
    showReview(control, blob, durationMs);
  };
  active = { control, recorder, stream, chunks, mime, startedAt: Date.now() };
  recorder.start();
  // Recording UI: button turns into a stop, label counts is implicit (kept simple).
  const btn = control.querySelector('[data-rec-toggle]');
  if (btn) { btn.classList.add('recording'); const lab = btn.querySelector('.rec-label'); if (lab) lab.textContent = 'Stop'; }
}
function stopRecording() { if (active && active.recorder.state !== 'inactive') active.recorder.stop(); }
function stopStream(a) { try { a.stream.getTracks().forEach(t => t.stop()); } catch (e) {} }

// Review panel: preview your take, then Save / Re-record / Cancel (per the plan's
// "preview + re-record before saving"). Uses a local object URL — nothing is uploaded
// until Save.
function showReview(control, blob, durationMs) {
  const url = URL.createObjectURL(blob);
  control.querySelector('.rec-takes')?.remove();
  const btn = control.querySelector('[data-rec-toggle]'); if (btn) btn.remove();
  const review = document.createElement('div');
  review.className = 'rec-review';
  review.innerHTML = `<audio class="rec-preview" src="${url}" controls preload="metadata"></audio>
    <button class="chip rec-save" type="button">Save</button>
    <button class="chip rec-redo" type="button">Re-record</button>
    <button class="chip rec-cancel" type="button">Cancel</button>`;
  control.appendChild(review);
  const cleanup = () => { URL.revokeObjectURL(url); };
  review.querySelector('.rec-cancel').addEventListener('click', () => { cleanup(); resetControl(control); });
  review.querySelector('.rec-redo').addEventListener('click', () => { cleanup(); resetControl(control); startRecording(control); });
  review.querySelector('.rec-save').addEventListener('click', async () => {
    review.querySelector('.rec-save').disabled = true;
    await uploadTake(control, blob, durationMs);
    cleanup();
  });
}

async function uploadTake(control, blob, durationMs) {
  const lesson = Number(control.dataset.lesson), itemKey = control.dataset.itemkey;
  const keep = clampKeep(settings.recordingsKeep);
  const ct = blob.type || 'audio/webm';
  setSyncStatus('saving…');
  try {
    const qs = `?lesson=${lesson}&itemKey=${encodeURIComponent(itemKey)}&durationMs=${Math.round(durationMs)}&keep=${keep}`;
    const res = await fetch(API_BASE + '/v1/minna/recordings' + qs, {
      method: 'POST', credentials: 'include', cache: 'no-store',
      headers: { 'Content-Type': ct }, body: blob,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    setTakes(lesson, itemKey, (data && data.takes) || []);
    setSyncStatus('✓ recording saved');
  } catch (e) {
    setSyncStatus('⚠ could not save recording');
  }
  resetControl(control);
}

async function deleteTake(control, id) {
  const lesson = Number(control.dataset.lesson), itemKey = control.dataset.itemkey;
  try { await api('/v1/minna/recordings/' + id, { method: 'DELETE' }); } catch (e) {}
  setTakes(lesson, itemKey, takesFor(lesson, itemKey).filter(t => t.id !== id));
  resetControl(control);
}

// ---------- wiring (delegated, once per lesson body) ----------
export function wireMinnaRecord(body) {
  body.addEventListener('click', e => {
    const control = e.target.closest('.rec-control'); if (!control) return;
    if (e.target.closest('[data-rec-toggle]')) {
      const btn = e.target.closest('[data-rec-toggle]');
      if (btn.classList.contains('recording')) stopRecording(); else startRecording(control);
      return;
    }
    const play = e.target.closest('[data-take-play]');
    if (play) { playTake(Number(play.dataset.takePlay), play); return; }
    const del = e.target.closest('[data-take-del]');
    if (del) { deleteTake(control, Number(del.dataset.takeDel)); return; }
  });
}
