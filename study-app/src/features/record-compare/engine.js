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
import { settings, saveSettings } from '../../settings-store.js';
import {
  escapeHtml, formatDuration, validClip, findTrimBounds, waveformPeaks, clampSpeed, COMPARE_SPEEDS, rmsLevel, normGains,
  // pure record-compare helpers extracted to core (C0) — direct (no binding):
  biasNative, biasTake, refClip, refVariantId, refShortLabel, parseControlCtx,
  // …and the base/httpServed/prefs-injected ones, wrapped below to keep their feature-local signatures
  // (core's nativeUrl is reached transitively via refUrl, so it isn't imported here):
  takeUrl as coreTakeUrl, refUrl as coreRefUrl,
  referenceVariants as coreReferenceVariants, defaultRef as coreDefaultRef, currentRef as coreCurrentRef,
} from '../../core/index.js';
import { HTTP_SERVED } from '../tts.js';
import { cycleMod } from '../audio.js';
import { S, audioCtx } from './state.js';   // shared mutable singletons + the one AudioContext
import { RECORD_SUPPORTED, isSpeakingMode, micOptionsHtml, startRecording, stopRecording } from './capture.js';
import { takesFor, newestTakeId, deleteTake } from './takes.js';

// RECORD_SUPPORTED, pickMime, mic selection, speaking mode (enter/exit/isSpeakingMode), silence
// trim (maybeTrim), and the MediaRecorder lifecycle (start/stopRecording, showReview) → ./capture.js.
// engine.js imports the few that its view/wiring still need (see the capture import above).

// ---------- speaking-mode bar (toggle + mic picker) ----------
// Rendered at the top of the lesson / practice view (Minna or Self-Talk). The toggle enters/
// leaves speaking mode; the mic picker pins a specific input so macOS doesn't flip AirPods to
// hands-free mode. Empty deviceId '' = system default. The record controls below only appear
// while speaking mode is on (gated by the caller via isSpeakingMode()).
export function speakingBarHtml() {
  if (!RECORD_SUPPORTED) return '';
  const on = isSpeakingMode();
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
      <input type="range" class="bias-slider" min="-100" max="100" value="${Math.round(S.compareBias * 100)}" aria-label="▶ both balance: you vs reference">
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
// micOptionsHtml (used by speakingBarHtml below) + initMicSelector → ./capture.js.

// ---------- take cache / upload / delete + setOnTakeSaved → ./takes.js ----------
// (loadRecordings/takesFor/newestTakeId(ForItem)/setTakes/uploadTake/deleteTake/setOnTakeSaved)

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
function ensureTakeAudio() { if (!S.takeAudioEl) { S.takeAudioEl = new Audio(); S.takeAudioEl.crossOrigin = 'use-credentials'; } return S.takeAudioEl; }
// Take-list ▶ — plays the WHOLE saved take (a quick listen, not a compare). Tears down any
// windowed compare playback first so its timeupdate stop can't cut this short.
function playTake(id, btn) {
  ensureTakeAudio();
  if (S.takeStop) { S.takeStop(); S.takeStop = null; }
  if (btn && btn === S.takePlayingBtn && !S.takeAudioEl.paused) { S.takeAudioEl.pause(); btn.classList.remove('playing'); S.takePlayingBtn = null; return; }
  if (S.takePlayingBtn) S.takePlayingBtn.classList.remove('playing');
  S.takeAudioEl.volume = 1;   // raw listen — full volume (compare playback may have left it normalized)
  S.takeAudioEl.src = API_BASE + '/v1/audio/recordings/' + id;
  S.takePlayingBtn = btn || null; if (btn) btn.classList.add('playing');
  S.takeAudioEl.onended = S.takeAudioEl.onerror = () => { if (S.takePlayingBtn) { S.takePlayingBtn.classList.remove('playing'); S.takePlayingBtn = null; } };
  S.takeAudioEl.play().catch(() => { if (btn) btn.classList.remove('playing'); S.takePlayingBtn = null; });
}
function stopTake() { if (S.takeStop) { S.takeStop(); S.takeStop = null; } if (S.takeAudioEl) { try { S.takeAudioEl.pause(); } catch (e) {} } }

// ---------- reference-audio playback ----------
// Plays the chosen reference voice (native vnjpclub clip OR a synth voice) over its play window.
// `onDone` fires once when playback finishes (window end / natural end / error), so the sequence
// player can chain. ONE reused credentialed element serves both: native is gated, and the public
// synth endpoint tolerates the credentialed cross-origin request (it's under the study-app CORS
// allowlist), so `crossOrigin='use-credentials'` is safe for either source.
function ensureNativeAudio() {
  if (!S.nativeAudioEl) { S.nativeAudioEl = new Audio(); S.nativeAudioEl.crossOrigin = 'use-credentials'; }
  return S.nativeAudioEl;
}
function stopNative() { if (S.nativeStop) { S.nativeStop(); S.nativeStop = null; } if (S.nativeAudioEl) { try { S.nativeAudioEl.pause(); } catch (e) {} } }
function playReference(ctx, v, window, volume, onDone) {
  const a = ensureNativeAudio();
  stopNative();
  a.src = refUrl(ctx, v);
  S.nativeStop = playRange(a, window, volume, () => { S.nativeStop = null; if (onDone) onDone(); });
}

// Stop ALL compare playback (reference + take), the cursor loop, and any lit compare buttons.
function stopCompare(control) {
  stopCursors();
  stopNative();
  stopTake();
  if (S.takePlayingBtn) { S.takePlayingBtn.classList.remove('playing'); S.takePlayingBtn = null; }
  if (control) control.querySelectorAll('.cmp-btn.playing').forEach(b => b.classList.remove('playing'));
}

// Play a take by id over its play window (used by the compare player; no take-list button).
function playTakeOnce(id, window, volume, onDone) {
  const a = ensureTakeAudio();
  stopTake();
  a.src = API_BASE + '/v1/audio/recordings/' + id;
  S.takeStop = playRange(a, window, volume, () => { S.takeStop = null; if (onDone) onDone(); });
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
  const control = S.cursorControl;
  if (!control) { S.cursorRaf = 0; return; }
  setCursor(control, 'you', progressIn(S.takeAudioEl, S.activeTakeWindow));
  setCursor(control, 'native', progressIn(S.nativeAudioEl, S.activeNativeWindow));
  S.cursorRaf = requestAnimationFrame(tickCursors);
}
function startCursors(control) { S.cursorControl = control; if (!S.cursorRaf) S.cursorRaf = requestAnimationFrame(tickCursors); }
function stopCursors() {
  if (S.cursorRaf) { cancelAnimationFrame(S.cursorRaf); S.cursorRaf = 0; }
  if (S.cursorControl) S.cursorControl.querySelectorAll('.rec-wave-cursor').forEach(c => { c.style.opacity = '0'; });
  S.cursorControl = null; S.activeNativeWindow = null; S.activeTakeWindow = null; S.bothPlaying = false;
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

// ---------- view: rebuild a control after capture/edit ----------
// Exported so capture.js (showReview) can rebuild a control post-save/cancel; moves to view.js (C1.6).
export function resetControl(control) {
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

// startRecording / stopRecording (MediaRecorder lifecycle) + showReview → ./capture.js.

// uploadTake / deleteTake / setOnTakeSaved → ./takes.js.

// ---------- compare player ----------
// newestTakeId / takesFor / setTakes → ./takes.js (imported above).
function litBtn(control, btn) { stopCompare(control); if (btn) btn.classList.add('playing'); }
function clearBtn(btn) { if (btn) btn.classList.remove('playing'); }

// Normalization gains for the currently-played reference/take pair (≤1, attenuate-only): bring the
// louder clip down so the two play at ~equal volume. Computed from each source's RMS over its
// spoken window; gain 1 when a level isn't known yet (buffer still decoding) or there's no pair.
function setActiveGains(ctx, id, refV) {
  if (refV && id != null) {
    const g = normGains(levelFor(refUrl(ctx, refV), refClip(ctx, refV)), levelFor(takeUrl(id), null));
    S.activeNativeGain = g.a; S.activeTakeGain = g.b;
  } else { S.activeNativeGain = 1; S.activeTakeGain = 1; }
}

// Compare BALANCE for ▶ both: a crossfader in [-1, 1] (−1 = all you, 0 = balanced, +1 = all
// reference) that scales each side ON TOP of the normalization gains, so it's easy to lean the
// simultaneous overlay toward one voice while A/B-ing. View-only (not synced) — a momentary
// comparison aid that resets to centre on reload. Only affects ▶ both (single playback ignores
// it); live while both are sounding (bothPlaying).
// The crossfader CURVE (biasNative/biasTake — b=+1 reference, b=−1 you, fade the other out) is pure
// → core/recordings.js; imported above.
function applyBothVolumes() {
  if (S.nativeAudioEl) S.nativeAudioEl.volume = clamp01(S.activeNativeGain * biasNative(S.compareBias));
  if (S.takeAudioEl) S.takeAudioEl.volume = clamp01(S.activeTakeGain * biasTake(S.compareBias));
}
function setCompareBias(v) { S.compareBias = Math.max(-1, Math.min(1, v)); if (S.bothPlaying) applyBothVolumes(); }

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
    litBtn(control, btn); S.activeTakeWindow = tw; S.activeNativeWindow = null; startCursors(control);
    playTakeOnce(id, tw, S.activeTakeGain, () => { clearBtn(btn); stopCursors(); });
    return;
  }
  if (action === 'seq') {
    const id = newestTakeId(control), v = currentRef(control, ctx); if (id == null || !v) return;
    const nw = windowFor(refUrl(ctx, v), refClip(ctx, v)), tw = windowFor(takeUrl(id), null);
    setActiveGains(ctx, id, v);
    litBtn(control, btn); startCursors(control);
    const runOnce = (after) => {
      S.activeNativeWindow = nw; S.activeTakeWindow = null;
      playReference(ctx, v, nw, S.activeNativeGain, () => { S.activeNativeWindow = null; S.activeTakeWindow = tw; playTakeOnce(id, tw, S.activeTakeGain, after); });
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
    litBtn(control, btn); S.activeNativeWindow = nw; S.activeTakeWindow = tw; S.bothPlaying = true; startCursors(control);
    let pending = 2;
    const join = () => { if (--pending <= 0) { clearBtn(btn); stopCursors(); } };
    playReference(ctx, v, nw, S.activeNativeGain * biasNative(S.compareBias), join);
    playTakeOnce(id, tw, S.activeTakeGain * biasTake(S.compareBias), join);
    return;
  }
}
// ▶ reference single playback (its own play window, normalized against the newest take).
function playRef(control, ctx, btn, v) {
  if (!v) return;
  const nw = windowFor(refUrl(ctx, v), refClip(ctx, v));
  setActiveGains(ctx, newestTakeId(control), v);
  litBtn(control, btn); S.activeNativeWindow = nw; S.activeTakeWindow = null; startCursors(control);
  playReference(ctx, v, nw, S.activeNativeGain, () => { clearBtn(btn); stopCursors(); });
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
  if (S.nativeAudioEl) applySpeed(S.nativeAudioEl);
  if (S.takeAudioEl) applySpeed(S.takeAudioEl);
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
