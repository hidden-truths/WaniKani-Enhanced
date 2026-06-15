// RECORD-AND-COMPARE engine (audio-unify). The learner records themselves saying an item
// (a Minna vocab word / conversation line, or a Self-Talk phrase) and compares it to a chosen
// REFERENCE voice — the native clip if the item has one, else a synth voice (Siri/Google)
// rendered from the item's text. This module owns the MediaRecorder capture flow, upload, the
// per-item take list, gated take playback, the windowed compare player (you / reference / seq /
// both / loop), volume normalization, and the dual waveform.
//
// It is feature-agnostic: every bit of context (the partition `scope`, the per-item `itemKey`,
// the native src, the conversation clip, the synth `text`, and the audio CONTEXT used to resolve
// the default reference voice) rides on each control's `data-*`, so Minna and Self-Talk both feed
// it the same primitives — Minna glue lives in minna.js, Self-Talk glue in selftalk.js. `scope`
// is an opaque numeric partition: Minna passes a lesson number (1–50), Self-Talk a reserved id.
// It maps to the server's `lesson` query param + recordings column (kept as the wire name).
//
// Recordings are PRIVATE on the server (served only via the owner-gated
// /v1/audio/recordings/{id}); like the native audio, take playback uses one reused
// <audio crossOrigin='use-credentials'> so the session cookie authorizes it cross-origin.
// NOTE: this file lives one level deeper than the other features (features/record-compare/), so its
// relative imports carry an extra '../' vs a features/*.js module.
import { API_BASE } from '../../config.js';
import { account, api, setSyncStatus } from '../cloud-core.js';
import { settings, saveSettings } from '../../settings-store.js';
import {
  escapeHtml, clampKeep, formatDuration, validClip, findTrimBounds, waveformPeaks, clampSpeed, COMPARE_SPEEDS, rmsLevel, normGains,
  // pure record-compare helpers extracted to core (C0) — direct (no binding):
  encodeWav, chooseMime, RECORD_MIME_CANDIDATES, biasNative, biasTake, refClip, refVariantId, refShortLabel, parseControlCtx,
  // …and the base/httpServed/prefs-injected ones, wrapped below to keep their feature-local signatures
  // (core's nativeUrl is reached transitively via refUrl, so it isn't imported here):
  takeUrl as coreTakeUrl, refUrl as coreRefUrl,
  referenceVariants as coreReferenceVariants, defaultRef as coreDefaultRef, currentRef as coreCurrentRef,
} from '../../core/index.js';
import { HTTP_SERVED } from '../tts.js';
import { cycleMod } from '../audio.js';

// Capability gates. Recording needs getUserMedia + MediaRecorder; both are absent over
// insecure origins / old browsers. When unavailable we degrade to a quiet hint.
export const RECORD_SUPPORTED = !!(typeof navigator !== 'undefined' && navigator.mediaDevices
  && navigator.mediaDevices.getUserMedia && typeof window !== 'undefined' && window.MediaRecorder);

// Prefer opus-in-webm; fall back to whatever the browser supports (Safari → mp4). The
// server strips codec params and validates the base type (audio/webm|mp4|ogg|mpeg).
function pickMime() {
  if (!RECORD_SUPPORTED || !MediaRecorder.isTypeSupported) return '';
  return chooseMime(RECORD_MIME_CANDIDATES, (c) => MediaRecorder.isTypeSupported(c));
}

// ---------- input-device (microphone) selection ----------
// macOS flips AirPods to low-quality hands-free (HFP) mode the moment any app opens THEIR
// mic. By recording from an explicitly-chosen non-AirPods input (deviceId:{exact}), the
// AirPods input is never activated, so they stay in high-quality A2DP. The chosen device is
// DEVICE-LOCAL (a deviceId is per-browser/machine and unstable across them), so it's stored
// in localStorage, not the synced settings.
const MIC_KEY = 'jpverbs_micDevice';
let selectedMicId = (() => { try { return localStorage.getItem(MIC_KEY) || ''; } catch (e) { return ''; } })();
let micDevices = [];   // cached audioinput list; labels appear once mic permission is granted
function setSelectedMic(id) { selectedMicId = id || ''; try { id ? localStorage.setItem(MIC_KEY, id) : localStorage.removeItem(MIC_KEY); } catch (e) {} }
async function enumerateMics() {
  if (!RECORD_SUPPORTED || !navigator.mediaDevices.enumerateDevices) return [];
  try {
    micDevices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
  } catch (e) { micDevices = []; }
  // Drop a stored id that no longer exists (device unplugged) so we fall back to default.
  if (selectedMicId && !micDevices.some(d => d.deviceId === selectedMicId)) setSelectedMic('');
  return micDevices;
}
// The getUserMedia audio constraint for the chosen device (or the system default).
function micConstraint() {
  return selectedMicId ? { deviceId: { exact: selectedMicId } } : true;
}

// ---------- speaking mode (persistent mic stream) ----------
// Acquiring + releasing the mic per take makes macOS re-negotiate the input each time, which
// hitches (and re-triggers the AirPods HFP switch). Instead the user enters "speaking mode"
// once: we open ONE persistent MediaStream and keep it; each take just spins a MediaRecorder
// on that live stream (no getUserMedia per take). The record controls only render while in
// speaking mode. Exiting releases the stream. The flag is a module singleton shared by every
// consumer (Minna, Self-Talk) — only one tab is active at a time, and each tab's leave hook
// calls exitSpeakingMode(), so it never lingers.
let speakingMode = false, liveStream = null;
export function isSpeakingMode() { return speakingMode; }
function stopLiveStream() { if (liveStream) { try { liveStream.getTracks().forEach(t => t.stop()); } catch (e) {} liveStream = null; } }
// Acquire (or re-acquire, e.g. after a device change) the persistent stream. Returns true on
// success. Mirrors the per-take fallback: if an exact deviceId fails, retry the default once.
export async function enterSpeakingMode() {
  if (!RECORD_SUPPORTED) return false;
  stopLiveStream();
  try { liveStream = await navigator.mediaDevices.getUserMedia({ audio: micConstraint() }); }
  catch (e) {
    if (selectedMicId) { try { liveStream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e2) {} }
    if (!liveStream) { speakingMode = false; setSyncStatus('⚠ microphone blocked'); return false; }
  }
  speakingMode = true;
  enumerateMics().then(refreshMicSelectors);   // labels are available now that permission's granted
  return true;
}
export function exitSpeakingMode() { stopRecording(); stopLiveStream(); speakingMode = false; }

// ---------- silence trim (Web Audio) ----------
// After capture, decode → find the sound region (findTrimBounds, pure) → slice → re-encode
// to 16-bit PCM WAV. WAV because there's no in-browser opus/webm encoder for an AudioBuffer;
// clips are short so the uncompressed size stays well under the 2 MB cap. Gated by the
// `trimSilence` setting; any failure (decode unsupported, all-silence, too-short) falls back
// to the untouched original.
let _audioCtx = null;
function audioCtx() { if (!_audioCtx) { const C = window.AudioContext || window.webkitAudioContext; _audioCtx = new C(); } return _audioCtx; }
// encodeWav (Float32 → 16-bit PCM WAV Blob) is pure → core/recordings.js.
async function maybeTrim(blob, durationMs) {
  if (!settings.trimSilence) return { blob, durationMs };
  try {
    const ab = await audioCtx().decodeAudioData(await blob.arrayBuffer());
    const n = ab.length, chs = ab.numberOfChannels;
    const mono = new Float32Array(n);   // mix down to mono for the trimmed WAV
    for (let c = 0; c < chs; c++) { const d = ab.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / chs; }
    const b = findTrimBounds(mono, ab.sampleRate);
    if (!b) return { blob, durationMs };
    const slice = mono.subarray(b.start, b.end);
    if (slice.length < ab.sampleRate * 0.15) return { blob, durationMs };   // <150ms left → keep original
    return { blob: encodeWav(slice, ab.sampleRate), durationMs: Math.round((slice.length / ab.sampleRate) * 1000) };
  } catch (e) { return { blob, durationMs }; }
}

// ---------- speaking-mode bar (toggle + mic picker) ----------
// Rendered at the top of the lesson / practice view (Minna or Self-Talk). The toggle enters/
// leaves speaking mode; the mic picker pins a specific input so macOS doesn't flip AirPods to
// hands-free mode. Empty deviceId '' = system default. The record controls below only appear
// while speaking mode is on (gated by the caller via isSpeakingMode()).
export function speakingBarHtml() {
  if (!RECORD_SUPPORTED) return '';
  const on = speakingMode;
  // Docked in the navbar (#navExtra) so it floats at the top while studying. The mic picker +
  // speed/bias controls only render WHILE speaking — off, the bar is just the toggle (the
  // device/compare controls are meaningless until a stream is open). No verbose hint: the bar is
  // compact in the navbar, and the toggle label is self-explanatory.
  return `<div class="speaking-bar${on ? ' on' : ''}">
    <button class="chip speaking-toggle${on ? ' active' : ''}" type="button" data-speaking-toggle aria-pressed="${on}">
      <svg class="ic" aria-hidden="true"><use href="#i-mic"/></svg>${on ? 'Speaking — tap to stop' : 'Practice speaking'}</button>
    ${on ? `<span class="mic-pick">
      <label class="mic-lbl" for="micSelect">Mic</label>
      <select id="micSelect" class="mic-select" aria-label="Recording microphone">${micOptionsHtml()}</select>
    </span>` : ''}
    ${on ? speedControlHtml() : ''}
    ${on ? biasControlHtml() : ''}
  </div>`;
}
// The ▶ both balance crossfader (you ⟷ reference). Reads the live compareBias; wired in
// wireSpeakingControls via an input listener.
function biasControlHtml() {
  return `<span class="cmp-bias" title="Balance you vs reference in ▶ both">
      <span class="mic-lbl">You</span>
      <input type="range" class="bias-slider" min="-100" max="100" value="${Math.round(compareBias * 100)}" aria-label="▶ both balance: you vs reference">
      <span class="mic-lbl">Ref</span></span>`;
}
// The compare playback-speed segmented control (0.5/0.75/1×). Global — one rate for every
// compare on the view — shown only while speaking mode is on (the only time compares exist).
// Reads the current rate from settings.compareSpeed (synced); wired in wireSpeakingControls.
function speedControlHtml() {
  const cur = clampSpeed(settings.compareSpeed);
  const chips = COMPARE_SPEEDS.map(s => {
    const on = s === cur;
    return `<button class="chip speed-chip${on ? ' active' : ''}" type="button" data-speed="${s}" aria-pressed="${on}">${s}×</button>`;
  }).join('');
  return `<span class="cmp-speed" role="group" aria-label="Compare playback speed"><span class="mic-lbl">Speed</span>${chips}</span>`;
}
function micOptionsHtml() {
  const opts = [`<option value=""${selectedMicId ? '' : ' selected'}>System default</option>`];
  micDevices.forEach((d, i) => {
    const label = d.label || ('Microphone ' + (i + 1));
    opts.push(`<option value="${escapeHtml(d.deviceId)}"${d.deviceId === selectedMicId ? ' selected' : ''}>${escapeHtml(label)}</option>`);
  });
  return opts.join('');
}
function refreshMicSelectors() { document.querySelectorAll('.mic-select').forEach(sel => { sel.innerHTML = micOptionsHtml(); }); }
// Wire the mic <select> (per render — the element is recreated) + enumerate. `onChange` fires
// after the device changes so the caller can re-acquire the live stream if speaking. The
// devicechange listener attaches once globally so AirPods connect/disconnect refresh the list.
export function initMicSelector(container, onChange) {
  if (!RECORD_SUPPORTED) return;
  const sel = container.querySelector('.mic-select');
  if (sel && !sel.dataset.wired) {
    sel.dataset.wired = '1';
    sel.addEventListener('change', () => { setSelectedMic(sel.value); if (onChange) onChange(); });
  }
  enumerateMics().then(refreshMicSelectors);
  if (!initMicSelector._wired && navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    initMicSelector._wired = true;
    navigator.mediaDevices.addEventListener('devicechange', () => enumerateMics().then(refreshMicSelectors));
  }
}

// ---------- take cache (per scope, fetched once) ----------
// recCache[scope] = array of takes {id,lesson,itemKey,durationMs,createdAt} newest-first.
const recCache = {};
export async function loadRecordings(scope) {
  if (!account) { recCache[scope] = []; return []; }
  try {
    const r = await api('/v1/audio/recordings?lesson=' + scope);   // server param name is `lesson` (opaque partition)
    recCache[scope] = (r && r.recordings) || [];
  } catch (e) { recCache[scope] = recCache[scope] || []; }
  return recCache[scope];
}
function takesFor(scope, itemKey) {
  return (recCache[scope] || []).filter(t => t.itemKey === itemKey);
}
// Newest take id for an item (or null) — used by the caller to let a unified play button offer
// the user's own recording as a 'user'-kind variant. Reads the per-scope take cache that
// loadRecordings already populated on render.
export function newestTakeIdForItem(scope, itemKey) {
  const takes = takesFor(scope, itemKey);
  return takes.length ? takes[0].id : null;
}
// Replace one item's takes in the cache (after upload/delete) without a refetch.
function setTakes(scope, itemKey, takes) {
  const others = (recCache[scope] || []).filter(t => t.itemKey !== itemKey);
  recCache[scope] = others.concat(takes).sort((a, b) => b.createdAt - a.createdAt);
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
// Apply the compare-player speed to an <audio> element before play. preservesPitch keeps the
// pronunciation clear when slowed (the whole point — mimic, don't chipmunk). Vendor-prefixed
// for older Safari/Firefox.
function applySpeed(a) {
  a.playbackRate = clampSpeed(settings.compareSpeed);
  a.preservesPitch = a.mozPreservesPitch = a.webkitPreservesPitch = true;
}

// ---------- windowed <audio> playback ----------
// Every compare playback plays a PLAY WINDOW [startSec, endSec] of its source — the detected
// spoken region (see windowFor) — rather than the whole file. This is what makes ▶ both line
// up: the native MP3 has built-in lead/tail silence, so without windowing its speaker would
// start well after your (already-tight) take. Windowing both to the same kind of region (same
// trim, same lead pad) makes the spoken onsets coincide, and the window is the SAME region the
// waveform draws, so what you see is what plays. We seek to start + stop at end via a timeupdate
// listener (Media-Fragments #t= is unreliable on <audio>). `window` null → play the whole file.
// Returns a stop() that tears down WITHOUT firing onDone (for external stops); onDone fires once
// on natural end / window end / error so the sequence + barrier players can chain.
function playRange(a, window, volume, onDone) {
  let done = false;
  const tu = window ? () => { if (a.currentTime >= window.end) finish(); } : null;
  function finish() {
    if (done) return; done = true;
    if (tu) a.removeEventListener('timeupdate', tu);
    a.onended = a.onerror = null;
    try { a.pause(); } catch (e) {}
    if (onDone) onDone();
  }
  a.onended = finish; a.onerror = finish;
  if (tu) a.addEventListener('timeupdate', tu);
  applySpeed(a);
  a.volume = clamp01(volume == null ? 1 : volume);   // normalization / bias gain
  const start = window ? window.start : 0;
  const go = () => { if (done) return; try { a.currentTime = start; } catch (e) {} a.play().catch(finish); };
  if (a.readyState >= 1) go(); else a.addEventListener('loadedmetadata', go, { once: true });
  return () => { if (done) return; done = true; if (tu) a.removeEventListener('timeupdate', tu); a.onended = a.onerror = null; try { a.pause(); } catch (e) {} };
}

// ---------- gated playback of a saved take ----------
let takeAudioEl = null, takePlayingBtn = null, takeStop = null;
function ensureTakeAudio() { if (!takeAudioEl) { takeAudioEl = new Audio(); takeAudioEl.crossOrigin = 'use-credentials'; } return takeAudioEl; }
// Take-list ▶ — plays the WHOLE saved take (a quick listen, not a compare). Tears down any
// windowed compare playback first so its timeupdate stop can't cut this short.
function playTake(id, btn) {
  ensureTakeAudio();
  if (takeStop) { takeStop(); takeStop = null; }
  if (btn && btn === takePlayingBtn && !takeAudioEl.paused) { takeAudioEl.pause(); btn.classList.remove('playing'); takePlayingBtn = null; return; }
  if (takePlayingBtn) takePlayingBtn.classList.remove('playing');
  takeAudioEl.volume = 1;   // raw listen — full volume (compare playback may have left it normalized)
  takeAudioEl.src = API_BASE + '/v1/audio/recordings/' + id;
  takePlayingBtn = btn || null; if (btn) btn.classList.add('playing');
  takeAudioEl.onended = takeAudioEl.onerror = () => { if (takePlayingBtn) { takePlayingBtn.classList.remove('playing'); takePlayingBtn = null; } };
  takeAudioEl.play().catch(() => { if (btn) btn.classList.remove('playing'); takePlayingBtn = null; });
}
function stopTake() { if (takeStop) { takeStop(); takeStop = null; } if (takeAudioEl) { try { takeAudioEl.pause(); } catch (e) {} } }

// ---------- reference-audio playback ----------
// Plays the chosen reference voice (native vnjpclub clip OR a synth voice) over its play window.
// `onDone` fires once when playback finishes (window end / natural end / error), so the sequence
// player can chain. ONE reused credentialed element serves both: native is gated, and the public
// synth endpoint tolerates the credentialed cross-origin request (it's under the study-app CORS
// allowlist), so `crossOrigin='use-credentials'` is safe for either source.
let nativeAudioEl = null, nativeStop = null;
function ensureNativeAudio() {
  if (!nativeAudioEl) { nativeAudioEl = new Audio(); nativeAudioEl.crossOrigin = 'use-credentials'; }
  return nativeAudioEl;
}
function stopNative() { if (nativeStop) { nativeStop(); nativeStop = null; } if (nativeAudioEl) { try { nativeAudioEl.pause(); } catch (e) {} } }
function playReference(ctx, v, window, volume, onDone) {
  const a = ensureNativeAudio();
  stopNative();
  a.src = refUrl(ctx, v);
  nativeStop = playRange(a, window, volume, () => { nativeStop = null; if (onDone) onDone(); });
}

// Stop ALL compare playback (reference + take), the cursor loop, and any lit compare buttons.
function stopCompare(control) {
  stopCursors();
  stopNative();
  stopTake();
  if (takePlayingBtn) { takePlayingBtn.classList.remove('playing'); takePlayingBtn = null; }
  if (control) control.querySelectorAll('.cmp-btn.playing').forEach(b => b.classList.remove('playing'));
}

// Play a take by id over its play window (used by the compare player; no take-list button).
function playTakeOnce(id, window, volume, onDone) {
  const a = ensureTakeAudio();
  stopTake();
  a.src = API_BASE + '/v1/audio/recordings/' + id;
  takeStop = playRange(a, window, volume, () => { takeStop = null; if (onDone) onDone(); });
}

// ---------- dual waveform (Web Audio decode → canvas) ----------
// Draw the newest take ("you") next to the reference audio so timing/shape are comparable. Both
// sources are already cached same-origin and cookie-gated, so we fetch the bytes WITH
// credentials (mirroring the <audio crossOrigin='use-credentials'> path) and decodeAudioData
// them. Canvas — not the app's usual hand-rolled SVG charts — because a per-sample waveform is
// the wrong shape for SVG (heavy DOM) and the bytes are right there to decode. Decode FAILS
// SAFE: any fetch/decode error (e.g. Safari can't decode an opus take when trimSilence is off,
// or we're offline) just skips that waveform; the <audio>-driven compare buttons are unaffected.
const WAVE_W = 140, WAVE_H = 30;
// The play/draw window keeps a SMALL, EQUAL lead pad on both sources so the spoken onsets line
// up under ▶ both (the save-time trim uses a bigger 160 ms pad to protect onsets on disk; here
// alignment matters more than a few ms of breath). Same pad on reference + take → same offset
// before the vowel → aligned.
const COMPARE_TRIM = { leadPadMs: 60, tailPadMs: 120 };
const bufferCache = new Map();      // url → Promise<AudioBuffer|null> (promise cached so concurrent paints share one decode)
const resolvedBuffers = new Map();  // url → AudioBuffer (the resolved value, for synchronous window/onset lookups)
const windowCache = new Map();      // "url|clip" → {start,end} speech window (memoized once the buffer decodes)
// URL builders bind API_BASE onto the pure shapes in core/refs.js. nativeUrl is core-internal now
// (only refUrl needs it); takeUrl is used directly by several waveform/level/compare call sites here.
function takeUrl(id) { return coreTakeUrl(API_BASE, id); }
function fetchAudioBuffer(url) {
  if (bufferCache.has(url)) return bufferCache.get(url);
  const p = (async () => {
    try {
      const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
      if (!res.ok) return null;
      return await audioCtx().decodeAudioData(await res.arrayBuffer());
    } catch (e) { return null; }
  })();
  bufferCache.set(url, p);
  p.then(buf => { if (buf) resolvedBuffers.set(url, buf); else bufferCache.delete(url); });   // cache success; drop failures so a later paint can retry
  return p;
}
function bufferToMono(buf) {
  const n = buf.length, chs = buf.numberOfChannels, m = new Float32Array(n);
  for (let c = 0; c < chs; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) m[i] += d[i] / chs; }
  return m;
}
// The spoken region of a decoded buffer, in seconds, optionally restricted to a conversation
// line's clip first. Reuses findTrimBounds (the same detector as the save-time trim) so the
// "what plays" region matches the "what's drawn" region. Falls back to the clip / whole file
// when the buffer isn't decoded yet or no speech is found.
function speechWindow(buf, clip) {
  const v = validClip(clip);
  if (!buf) return v ? { start: v[0], end: v[1] } : null;
  const sr = buf.sampleRate;
  let mono = bufferToMono(buf), off = 0;
  if (v) { const s = Math.max(0, Math.floor(v[0] * sr)), e = Math.min(mono.length, Math.floor(v[1] * sr)); if (e > s) { mono = mono.subarray(s, e); off = s; } }
  const b = findTrimBounds(mono, sr, COMPARE_TRIM);
  if (!b) return v ? { start: v[0], end: v[1] } : { start: 0, end: buf.length / sr };
  return { start: (off + b.start) / sr, end: (off + b.end) / sr };
}
// Memoized speech window for a url (+optional clip). Returns a fallback (clip / null) until the
// buffer decodes, then the real spoken window thereafter — so playback and the waveform agree.
function windowFor(url, clip) {
  const v = validClip(clip);
  const key = url + '|' + (v ? v[0] + ',' + v[1] : '');
  if (windowCache.has(key)) return windowCache.get(key);
  const buf = resolvedBuffers.get(url) || null;
  const w = speechWindow(buf, clip);
  if (buf) windowCache.set(key, w);   // only memoize once a real buffer backed it
  return w;
}
// RMS loudness of a source over its spoken window — the level used to normalize reference vs take
// to ~equal volume. null until the buffer decodes (caller treats that as "don't normalize yet").
const levelCache = new Map();
function levelFor(url, clip) {
  const v = validClip(clip);
  const key = url + '|' + (v ? v[0] + ',' + v[1] : '');
  if (levelCache.has(key)) return levelCache.get(key);
  const buf = resolvedBuffers.get(url) || null;
  if (!buf) return null;   // not decoded yet
  const sr = buf.sampleRate;
  const w = windowFor(url, clip) || { start: 0, end: buf.length / sr };
  const mono = bufferToMono(buf);
  const s = Math.max(0, Math.floor(w.start * sr)), e = Math.min(mono.length, Math.floor(w.end * sr));
  const lvl = rmsLevel(e > s ? mono.subarray(s, e) : mono);
  levelCache.set(key, lvl);
  return lvl;
}
function drawWave(canvas, mono, colorVar) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(WAVE_W * dpr); canvas.height = Math.round(WAVE_H * dpr);
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, WAVE_W, WAVE_H);
  ctx.fillStyle = getComputedStyle(canvas).getPropertyValue(colorVar).trim() || '#888';
  const bins = Math.max(1, Math.floor(WAVE_W / 2));   // 1px bar + 1px gap
  const peaks = waveformPeaks(mono, bins);
  const mid = WAVE_H / 2;
  for (let i = 0; i < peaks.length; i++) {
    const h = Math.max(1, peaks[i] * (WAVE_H - 2));   // 1px floor so a silent stretch still shows a baseline
    ctx.fillRect(i * 2, mid - h / 2, 1, h);
  }
}
// Decode `url`, then draw its SPEECH WINDOW (the same region playback uses) onto `canvas` in
// the theme color `colorVar`. Re-checks isConnected because a re-render may replace the canvas
// while the decode is in flight.
async function paintWave(canvas, url, clip, colorVar) {
  const buf = await fetchAudioBuffer(url);
  if (!buf || !canvas.isConnected) return;
  const sr = buf.sampleRate;
  const w = windowFor(url, clip) || { start: 0, end: buf.length / sr };
  let mono = bufferToMono(buf);
  const s = Math.max(0, Math.floor(w.start * sr)), e = Math.min(mono.length, Math.floor(w.end * sr));
  if (e > s) mono = mono.subarray(s, e);
  drawWave(canvas, mono, colorVar);
}
// Paint both waveforms for one control (you = newest take in --godan; reference = native clip or
// synth voice in --ichidan), each cropped to its spoken window. Reads context off the control.
function paintControlWaves(control) {
  const youCanvas = control.querySelector('canvas.rec-wave[data-wave="you"]');
  if (youCanvas) { const id = newestTakeId(control); if (id != null) paintWave(youCanvas, takeUrl(id), null, '--godan'); }
  const natCanvas = control.querySelector('canvas.rec-wave[data-wave="native"]');
  if (natCanvas) {
    const ctx = controlCtx(control), v = currentRef(control, ctx);
    if (v) { paintWave(natCanvas, refUrl(ctx, v), refClip(ctx, v), '--ichidan'); setRefCaption(control, v); }
  }
}
// Keep the reference waveform's caption in sync with the selected reference voice.
function setRefCaption(control, v) {
  const cap = control.querySelector('.rec-wave-wrap[data-wave="native"] .rec-wave-cap');
  if (cap) cap.textContent = refShortLabel(v);
}
// Per-render hook (called from the caller's wire step after the body re-renders).
export function paintCompareWaveforms(root) {
  if (!root) return;
  root.querySelectorAll('.rec-control').forEach(paintControlWaves);
}

// ---------- live playback cursor ----------
// One rAF loop drives the cursor overlay(s) of whichever control is currently playing (only
// one plays at a time — stopCompare clears the others). Each cursor maps its element's
// currentTime over that element's ACTIVE PLAY WINDOW (so it sweeps the drawn region, not the
// whole file). Just moves an absolutely-positioned div — no canvas redraw per frame.
let cursorControl = null, cursorRaf = 0, activeNativeWindow = null, activeTakeWindow = null;
function setCursor(control, wave, progress) {
  const cur = control.querySelector('.rec-wave-wrap[data-wave="' + wave + '"] .rec-wave-cursor');
  if (!cur) return;
  if (progress == null) { cur.style.opacity = '0'; return; }
  cur.style.opacity = '1';
  cur.style.left = (Math.max(0, Math.min(1, progress)) * 100) + '%';
}
function progressIn(a, w) {
  if (!a || a.paused) return null;
  if (w && w.end > w.start) return (a.currentTime - w.start) / (w.end - w.start);
  if (isFinite(a.duration) && a.duration > 0) return a.currentTime / a.duration;
  return null;
}
function tickCursors() {
  const control = cursorControl;
  if (!control) { cursorRaf = 0; return; }
  setCursor(control, 'you', progressIn(takeAudioEl, activeTakeWindow));
  setCursor(control, 'native', progressIn(nativeAudioEl, activeNativeWindow));
  cursorRaf = requestAnimationFrame(tickCursors);
}
function startCursors(control) { cursorControl = control; if (!cursorRaf) cursorRaf = requestAnimationFrame(tickCursors); }
function stopCursors() {
  if (cursorRaf) { cancelAnimationFrame(cursorRaf); cursorRaf = 0; }
  if (cursorControl) cursorControl.querySelectorAll('.rec-wave-cursor').forEach(c => { c.style.opacity = '0'; });
  cursorControl = null; activeNativeWindow = null; activeTakeWindow = null; bothPlaying = false;
}

// ---------- HTML ----------
// One control per recordable item (a vocab word, a conversation line, or a Self-Talk phrase).
// `nativeSrc` is the item's native-audio path (empty for items with no native clip, e.g. a
// Self-Talk phrase); `clip` is the resolved [start,end] for a conversation line (null for a
// whole-file item); `needsClip` marks a conversation line whose native compare needs a clip
// first; `text` is the synth text (enables a synth reference voice); `audioCtx` is the per-context
// audio key the resolver uses to pick the DEFAULT reference voice (Minna='minna', Self-Talk=
// 'selftalk'; defaults to 'minna'). All ride on the dataset so the delegated handlers +
// resetControl can rebuild without re-threading args.
export function recordControlHtml(scope, itemKey, nativeSrc, clip, needsClip, text, audioCtx) {
  const v = validClip(clip);
  const attrs = [
    `data-scope="${scope}"`,
    `data-itemkey="${escapeHtml(itemKey)}"`,
    nativeSrc ? `data-native="${escapeHtml(nativeSrc)}"` : '',
    v ? `data-clip="${v[0]},${v[1]}"` : '',
    needsClip ? `data-needsclip="1"` : '',
    text ? `data-text="${escapeHtml(text)}"` : '',
    audioCtx ? `data-audioctx="${escapeHtml(audioCtx)}"` : '',
  ].filter(Boolean).join(' ');
  return `<div class="rec-control" ${attrs}>${recordControlInner(scope, itemKey, { nativeSrc, clip: v, needsClip, text: text || '', audioCtx: audioCtx || 'minna' })}</div>`;
}
// Read the compare context back off a control's dataset (so resetControl can rebuild). `text` is the
// item's synth text (a word's ttsText / a line or phrase's plain sentence) — enables a synth
// reference voice. `audioCtx` picks the per-context default reference voice from the resolver.
// Read the compare context back off a control's dataset (so resetControl can rebuild). The parse is
// pure → core/refs.js (parseControlCtx); nativePlayable + the reference selection live there too.
function controlCtx(control) { return parseControlCtx(control.dataset); }

// ---------- reference (compare-target) variants: native + synth voices, via the resolver ----------
// The compare player's "reference" generalizes the old native-only target to ANY voice (audio-unify
// Phase 3 / ⑤): native (the cached vnjpclub clip) OR a synth voice (Siri/Google, rendered from the
// item's text). The USER's own take is the "you" side, never a reference. The selection logic + URL
// shapes are PURE → core/refs.js (variantOrder for the cycle list, resolveVariant for the per-context
// default — so the per-context priority drives it). These thin wrappers bind the feature-owned inputs
// the core fns take: API_BASE, the live HTTP_SERVED flag, and settings.audioPrefs. refClip/refVariantId/
// refShortLabel are pure (no binding) → imported directly from core.
function referenceVariants(ctx) { return coreReferenceVariants(ctx, HTTP_SERVED); }
function defaultRef(ctx) { return coreDefaultRef(ctx, HTTP_SERVED, settings.audioPrefs); }
// The control's currently-selected reference: its saved data-ref if still available, else the default.
function currentRef(control, ctx) { return coreCurrentRef(control.dataset.ref || '', ctx, HTTP_SERVED, settings.audioPrefs); }
// Playback URL for a reference variant: native is the gated proxy (sliced by refClip's line clip); a
// synth voice is the public tagged-TTS endpoint (no clip — windowFor trims its silence).
function refUrl(ctx, v) { return coreRefUrl(API_BASE, ctx, v); }

function recordControlInner(scope, itemKey, ctx) {
  if (!RECORD_SUPPORTED) return `<span class="rec-unsupported">Recording needs a modern browser + microphone.</span>`;
  return `<button class="rec-btn" type="button" data-rec-toggle aria-label="Record yourself"><svg class="ic" aria-hidden="true"><use href="#i-mic"/></svg><span class="rec-label">Record</span></button>
    <div class="rec-takes">${takesHtml(scope, itemKey)}</div>
    ${compareHtml(scope, itemKey, ctx)}`;
}
function takesHtml(scope, itemKey) {
  const takes = takesFor(scope, itemKey);
  if (!takes.length) return '';
  return takes.map(t => `<span class="rec-take">
      <button class="rec-take-play" type="button" data-take-play="${t.id}" aria-label="Play your recording"><svg class="ic" aria-hidden="true"><use href="#i-play"/></svg>${escapeHtml(formatDuration(t.durationMs)) || 'take'}</button>
      <button class="rec-take-del" type="button" data-take-del="${t.id}" aria-label="Delete this recording"><svg class="ic" aria-hidden="true"><use href="#i-trash"/></svg></button>
    </span>`).join('');
}
// The compare player: ▶ <reference> / ▶ you / ▶ reference→you + both + loop. Shows only once at
// least one take exists. The reference buttons appear when ANY reference voice is available — a
// native clip OR a synth voice from the item's text (so a conversation line without a clip yet can
// still compare against Siri/Google). The ▶ reference button names the current voice; Alt/Shift-
// click it to cycle the available voices (③-style). A truly-referenceless item gets only ▶ you.
function compareHtml(scope, itemKey, ctx) {
  const takes = takesFor(scope, itemKey);
  if (!takes.length) return '';
  const refs = referenceVariants(ctx);
  const canRef = refs.length > 0;
  const ref = canRef ? defaultRef(ctx) : null;
  const refTitle = `Reference voice — ${escapeHtml(refShortLabel(ref))}${refs.length > 1 ? ` (⌥/⇧-click to switch, ${refs.length} voices)` : ''}`;
  const refBtns = canRef
    ? `<button class="cmp-btn cmp-ref" type="button" data-cmp="ref" title="${refTitle}"><svg class="ic" aria-hidden="true"><use href="#i-volume"/></svg><span class="cmp-ref-lbl">${escapeHtml(refShortLabel(ref))}</span></button>
       <button class="cmp-btn" type="button" data-cmp="seq" title="Reference, then you"><svg class="ic" aria-hidden="true"><use href="#i-play"/></svg>→you</button>
       <button class="cmp-btn" type="button" data-cmp="both" title="Play reference + your take together"><svg class="ic" aria-hidden="true"><use href="#i-volume"/></svg>both</button>
       <button class="cmp-btn cmp-loop" type="button" data-cmp="loop" aria-pressed="false" title="Loop reference→you">loop</button>`
    : '';
  return `<div class="rec-compare"><span class="cmp-label">compare</span>
    <button class="cmp-btn" type="button" data-cmp="you"><svg class="ic" aria-hidden="true"><use href="#i-play"/></svg>you</button>
    ${refBtns}</div>${waveRowHtml(canRef, refShortLabel(ref))}`;
}
// The dual-waveform row under the compare buttons: a "you" wave always, a "native" wave when a
// reference is available. Canvases are painted (decoded) post-render by paintControlWaves;
// each wrap holds the absolutely-positioned cursor overlay. width/height match WAVE_W/H so the
// blank canvas is correctly sized before paint (and inside a closed <details>, where layout is
// unavailable). The cursor starts hidden (opacity 0).
function waveWrapHtml(wave, cap) {
  return `<span class="rec-wave-wrap" data-wave="${wave}">
      <canvas class="rec-wave" data-wave="${wave}" width="${WAVE_W}" height="${WAVE_H}"></canvas>
      <span class="rec-wave-cursor" style="opacity:0"></span>
      <span class="rec-wave-cap">${cap}</span></span>`;
}
function waveRowHtml(canRef, refLabel) {
  return `<div class="rec-wave-row">${waveWrapHtml('you', 'you')}${canRef ? waveWrapHtml('native', refLabel || 'ref') : ''}</div>`;
}

// ---------- capture state (one active recording at a time) ----------
let active = null;   // { control, recorder, chunks, mime, startedAt }

function resetControl(control) {
  const scope = Number(control.dataset.scope), itemKey = control.dataset.itemkey;
  const loop = control.dataset.loop === '1';   // preserve the loop toggle across re-renders
  control.innerHTML = recordControlInner(scope, itemKey, controlCtx(control));
  if (loop) { const lb = control.querySelector('[data-cmp="loop"]'); if (lb) { lb.classList.add('active'); lb.setAttribute('aria-pressed', 'true'); } }
  refreshRefUi(control);        // restore the selected reference voice's label (compareHtml rendered the default)
  paintControlWaves(control);   // (re)decode + draw this control's waveforms after the rebuild
}
// Sync the ▶ reference button label + the reference waveform caption to the control's selected
// voice (data-ref, falling back to the resolver default) — called after a re-render or a cycle.
function refreshRefUi(control) {
  const v = currentRef(control, controlCtx(control));
  const lbl = control.querySelector('.cmp-ref-lbl'); if (lbl) lbl.textContent = refShortLabel(v);
  setRefCaption(control, v);
}

// Records from the PERSISTENT speaking-mode stream — no getUserMedia per take, so there's no
// per-take device renegotiation hitch. Only callable while speaking mode holds the stream.
function startRecording(control) {
  if (!liveStream) return;          // controls only render in speaking mode, but guard anyway
  if (active) stopRecording();      // never run two at once
  const mime = pickMime();
  const recorder = mime ? new MediaRecorder(liveStream, { mimeType: mime }) : new MediaRecorder(liveStream);
  const chunks = [];
  recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.onstop = async () => {
    const raw = new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' });
    const rawDur = Date.now() - active.startedAt;
    active = null;                  // keep liveStream open for the next take
    const { blob, durationMs } = await maybeTrim(raw, rawDur);   // auto-trim leading/trailing silence
    showReview(control, blob, durationMs);
  };
  active = { control, recorder, chunks, mime, startedAt: Date.now() };
  recorder.start();
  // Recording UI: button turns into a stop, label counts is implicit (kept simple).
  const btn = control.querySelector('[data-rec-toggle]');
  if (btn) { btn.classList.add('recording'); const lab = btn.querySelector('.rec-label'); if (lab) lab.textContent = 'Stop'; }
}
function stopRecording() { if (active && active.recorder.state !== 'inactive') active.recorder.stop(); }

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
  const scope = Number(control.dataset.scope), itemKey = control.dataset.itemkey;
  const keep = clampKeep(settings.recordingsKeep);
  const ct = blob.type || 'audio/webm';
  setSyncStatus('saving…');
  try {
    const qs = `?lesson=${scope}&itemKey=${encodeURIComponent(itemKey)}&durationMs=${Math.round(durationMs)}&keep=${keep}`;
    const res = await fetch(API_BASE + '/v1/audio/recordings' + qs, {
      method: 'POST', credentials: 'include', cache: 'no-store',
      headers: { 'Content-Type': ct }, body: blob,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    setTakes(scope, itemKey, (data && data.takes) || []);
    setSyncStatus('✓ recording saved');
    if (onTakeSaved) { try { onTakeSaved(scope, itemKey); } catch (e) {} }   // notify the host (e.g. Self-Talk practice signal)
  } catch (e) {
    setSyncStatus('⚠ could not save recording');
  }
  resetControl(control);
}

async function deleteTake(control, id) {
  const scope = Number(control.dataset.scope), itemKey = control.dataset.itemkey;
  try { await api('/v1/audio/recordings/' + id, { method: 'DELETE' }); } catch (e) {}
  setTakes(scope, itemKey, takesFor(scope, itemKey).filter(t => t.id !== id));
  resetControl(control);
}

// Optional host hook fired after a take is successfully saved (scope, itemKey) — lets a consumer
// record a practice signal (Self-Talk's "practiced today"/streak) without coupling this engine to it.
let onTakeSaved = null;
export function setOnTakeSaved(fn) { onTakeSaved = fn || null; }

// ---------- compare player ----------
function newestTakeId(control) {
  const takes = takesFor(Number(control.dataset.scope), control.dataset.itemkey);
  return takes.length ? takes[0].id : null;
}
function litBtn(control, btn) { stopCompare(control); if (btn) btn.classList.add('playing'); }
function clearBtn(btn) { if (btn) btn.classList.remove('playing'); }

// Normalization gains for the currently-played reference/take pair (≤1, attenuate-only): bring the
// louder clip down so the two play at ~equal volume. Computed from each source's RMS over its
// spoken window; gain 1 when a level isn't known yet (buffer still decoding) or there's no pair.
let activeNativeGain = 1, activeTakeGain = 1;
function setActiveGains(ctx, id, refV) {
  if (refV && id != null) {
    const g = normGains(levelFor(refUrl(ctx, refV), refClip(ctx, refV)), levelFor(takeUrl(id), null));
    activeNativeGain = g.a; activeTakeGain = g.b;
  } else { activeNativeGain = 1; activeTakeGain = 1; }
}

// Compare BALANCE for ▶ both: a crossfader in [-1, 1] (−1 = all you, 0 = balanced, +1 = all
// reference) that scales each side ON TOP of the normalization gains, so it's easy to lean the
// simultaneous overlay toward one voice while A/B-ing. View-only (not synced) — a momentary
// comparison aid that resets to centre on reload. Only affects ▶ both (single playback ignores
// it); live while both are sounding (bothPlaying).
// The crossfader CURVE (biasNative/biasTake — b=+1 reference, b=−1 you, fade the other out) is pure
// → core/recordings.js; imported above.
let compareBias = 0, bothPlaying = false;
function applyBothVolumes() {
  if (nativeAudioEl) nativeAudioEl.volume = clamp01(activeNativeGain * biasNative(compareBias));
  if (takeAudioEl) takeAudioEl.volume = clamp01(activeTakeGain * biasTake(compareBias));
}
function setCompareBias(v) { compareBias = Math.max(-1, Math.min(1, v)); if (bothPlaying) applyBothVolumes(); }

// Advance the control's reference voice to the next available one (Alt/Shift-click on ▶ reference),
// persisting the choice on data-ref so it survives re-render; updates the button label + waveform.
function cycleReference(control, ctx) {
  const list = referenceVariants(ctx);
  if (list.length < 2) return currentRef(control, ctx);
  const cur = currentRef(control, ctx);
  let i = list.findIndex((v) => refVariantId(v) === refVariantId(cur));
  const next = list[(i + 1 + (i < 0 ? 1 : 0)) % list.length];
  control.dataset.ref = refVariantId(next);
  refreshRefUi(control);
  paintControlWaves(control);   // repaint the reference waveform for the new voice
  return next;
}

function handleCompare(control, action, btn, e) {
  const ctx = controlCtx(control);
  // ▶ reference: Alt/Shift-click switches voice (and plays the new one); a plain click on the lit
  // button stops; otherwise play the current reference.
  if (action === 'ref') {
    if (cycleMod(e)) { const v = cycleReference(control, ctx); playRef(control, ctx, btn, v); return; }
    if (btn && btn.classList.contains('playing')) { stopCompare(control); return; }
    playRef(control, ctx, btn, currentRef(control, ctx));
    return;
  }
  // A second click on a lit button stops everything.
  if (btn && btn.classList.contains('playing')) { stopCompare(control); return; }
  if (action === 'loop') {
    const on = control.dataset.loop !== '1';
    control.dataset.loop = on ? '1' : '0';
    btn.classList.toggle('active', on); btn.setAttribute('aria-pressed', String(on));
    return;
  }
  if (action === 'you') {
    const id = newestTakeId(control); if (id == null) return;
    const tw = windowFor(takeUrl(id), null);
    setActiveGains(ctx, id, currentRef(control, ctx));
    litBtn(control, btn); activeTakeWindow = tw; activeNativeWindow = null; startCursors(control);
    playTakeOnce(id, tw, activeTakeGain, () => { clearBtn(btn); stopCursors(); });
    return;
  }
  if (action === 'seq') {
    const id = newestTakeId(control), v = currentRef(control, ctx); if (id == null || !v) return;
    const nw = windowFor(refUrl(ctx, v), refClip(ctx, v)), tw = windowFor(takeUrl(id), null);
    setActiveGains(ctx, id, v);
    litBtn(control, btn); startCursors(control);
    const runOnce = (after) => {
      activeNativeWindow = nw; activeTakeWindow = null;
      playReference(ctx, v, nw, activeNativeGain, () => { activeNativeWindow = null; activeTakeWindow = tw; playTakeOnce(id, tw, activeTakeGain, after); });
    };
    const loopOrStop = () => { if (control.dataset.loop === '1' && btn.classList.contains('playing')) runOnce(loopOrStop); else { clearBtn(btn); stopCursors(); } };
    runOnce(loopOrStop);
    return;
  }
  if (action === 'both') {
    // Overlay the reference + your take, started together (separate <audio> elements) — each on its
    // own SPOKEN WINDOW so the two onsets coincide despite the native's built-in padding, and
    // at NORMALIZED volume so neither drowns the other. A 2-count barrier clears the button +
    // cursors once BOTH finish (they differ in length). One-shot — loop stays seq-only. A second
    // click hits the playing-button stop path above.
    const id = newestTakeId(control), v = currentRef(control, ctx); if (id == null || !v) return;
    const nw = windowFor(refUrl(ctx, v), refClip(ctx, v)), tw = windowFor(takeUrl(id), null);
    setActiveGains(ctx, id, v);
    litBtn(control, btn); activeNativeWindow = nw; activeTakeWindow = tw; bothPlaying = true; startCursors(control);
    let pending = 2;
    const join = () => { if (--pending <= 0) { clearBtn(btn); stopCursors(); } };
    playReference(ctx, v, nw, activeNativeGain * biasNative(compareBias), join);
    playTakeOnce(id, tw, activeTakeGain * biasTake(compareBias), join);
    return;
  }
}
// ▶ reference single playback (its own play window, normalized against the newest take).
function playRef(control, ctx, btn, v) {
  if (!v) return;
  const nw = windowFor(refUrl(ctx, v), refClip(ctx, v));
  setActiveGains(ctx, newestTakeId(control), v);
  litBtn(control, btn); activeNativeWindow = nw; activeTakeWindow = null; startCursors(control);
  playReference(ctx, v, nw, activeNativeGain, () => { clearBtn(btn); stopCursors(); });
}

// Set the global compare speed from a speed-chip click: persist + sync, repaint the chip
// active states in place (no re-render), and update any in-flight playback live. `container` is
// the element holding the speed chips (the navbar #navExtra slot).
function setCompareSpeed(v, container) {
  settings.compareSpeed = clampSpeed(v);
  saveSettings();
  container.querySelectorAll('.speed-chip').forEach(b => {
    const on = Number(b.dataset.speed) === settings.compareSpeed;
    b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
  });
  if (nativeAudioEl) applySpeed(nativeAudioEl);
  if (takeAudioEl) applySpeed(takeAudioEl);
}

// ---------- wiring (delegated; attach-once, since the host re-renders body) ----------
// The speaking bar (speed chips + bias slider) lives in the navbar #navExtra slot, NOT in the
// view body — so its delegate attaches there (the slot persists; the host re-fills it per
// render). The toggle + mic picker are wired by the host (they re-render the view). Attach-once
// via the spkWired guard on the slot element.
export function wireSpeakingControls(navEl) {
  if (navEl.dataset.spkWired) return;
  navEl.dataset.spkWired = '1';
  navEl.addEventListener('input', e => {
    const slider = e.target.closest('.bias-slider');
    if (slider) setCompareBias(Number(slider.value) / 100);
  });
  navEl.addEventListener('click', e => {
    const speed = e.target.closest('[data-speed]');
    if (speed) setCompareSpeed(Number(speed.dataset.speed), navEl);
  });
}
export function wireRecordCompare(body) {
  if (body.dataset.recWired) return;   // body persists across re-renders — attach the delegate once
  body.dataset.recWired = '1';
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
    const cmp = e.target.closest('[data-cmp]');
    if (cmp) { handleCompare(control, cmp.dataset.cmp, cmp, e); return; }
  });
}
