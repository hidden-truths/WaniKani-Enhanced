// Waveform + cursor: the Web-Audio decode caches, the speech-window/level computation, the canvas
// dual-waveform painter, and the live playback cursor rAF. Split out of the record-and-compare
// engine (C1.5). The decode/window/level caches are waveform-LOCAL; the cursor reads the shared
// <audio> elements + active windows from state.js (S).
//
// DEAD-ENDS preserved verbatim: decode FAILS SAFE (any fetch/decode error just skips that waveform;
// the <audio> compare buttons are unaffected); the credentialed fetch mirrors the
// <audio crossOrigin='use-credentials'> path with cache:'no-store'; the drawn window == the played
// window (windowFor) so "what you see is what plays"; canvas (not SVG) for the per-sample waveform.
import { API_BASE } from '../../config.js';
import { validClip, findTrimBounds, waveformPeaks, rmsLevel, refClip, refShortLabel, takeUrl as coreTakeUrl } from '../../core/index.js';
import { S, audioCtx } from './state.js';
import { newestTakeId } from './takes.js';
// Forward deps used only at runtime (the view wrappers move to view.js C1.6). Safe import cycle.
import { controlCtx, currentRef, refUrl } from './view.js';

const WAVE_W = 140, WAVE_H = 30;
export { WAVE_W, WAVE_H };   // consumed by view's waveWrapHtml (canvas width/height)
// The play/draw window keeps a SMALL, EQUAL lead pad on both sources so the spoken onsets line
// up under ▶ both (the save-time trim uses a bigger 160 ms pad to protect onsets on disk; here
// alignment matters more than a few ms of breath). Same pad on reference + take → same offset
// before the vowel → aligned.
const COMPARE_TRIM = { leadPadMs: 60, tailPadMs: 120 };
const bufferCache = new Map();      // url → Promise<AudioBuffer|null> (promise cached so concurrent paints share one decode)
const resolvedBuffers = new Map();  // url → AudioBuffer (the resolved value, for synchronous window/onset lookups)
const windowCache = new Map();      // "url|clip" → {start,end} speech window (memoized once the buffer decodes)
// takeUrl binds API_BASE onto the pure core/refs.js shape; used by the take waveform + the compare
// player (engine) + normalization (playback).
export function takeUrl(id) { return coreTakeUrl(API_BASE, id); }
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
export function windowFor(url, clip) {
  const v = validClip(clip);
  const key = url + '|' + (v ? v[0] + ',' + v[1] : '');
  if (windowCache.has(key)) return windowCache.get(key);
  const buf = resolvedBuffers.get(url) || null;
  const w = speechWindow(buf, clip);
  if (buf) windowCache.set(key, w);   // only memoize once a real buffer backed it
  return w;
}
// The mono samples of a decoded buffer cropped to its spoken window (the region windowFor
// returns) — shared by levelFor (RMS for volume-matching) and paintWave (the drawn peaks) so
// the loudness measured and the waveform drawn cover the EXACT same samples.
function monoInWindow(buf, url, clip) {
  const sr = buf.sampleRate;
  const w = windowFor(url, clip) || { start: 0, end: buf.length / sr };
  const mono = bufferToMono(buf);
  const s = Math.max(0, Math.floor(w.start * sr)), e = Math.min(mono.length, Math.floor(w.end * sr));
  return e > s ? mono.subarray(s, e) : mono;
}
// RMS loudness of a source over its spoken window — the level used to normalize reference vs take
// to ~equal volume. null until the buffer decodes (caller treats that as "don't normalize yet").
const levelCache = new Map();
export function levelFor(url, clip) {
  const v = validClip(clip);
  const key = url + '|' + (v ? v[0] + ',' + v[1] : '');
  if (levelCache.has(key)) return levelCache.get(key);
  const buf = resolvedBuffers.get(url) || null;
  if (!buf) return null;   // not decoded yet
  const lvl = rmsLevel(monoInWindow(buf, url, clip));
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
  drawWave(canvas, monoInWindow(buf, url, clip), colorVar);
}
// Paint both waveforms for one control (you = newest take in --godan; reference = native clip or
// synth voice in --ichidan), each cropped to its spoken window. Reads context off the control.
export function paintControlWaves(control) {
  const youCanvas = control.querySelector('canvas.rec-wave[data-wave="you"]');
  if (youCanvas) { const id = newestTakeId(control); if (id != null) paintWave(youCanvas, takeUrl(id), null, '--godan'); }
  const natCanvas = control.querySelector('canvas.rec-wave[data-wave="native"]');
  if (natCanvas) {
    const ctx = controlCtx(control), v = currentRef(control, ctx);
    if (v) { paintWave(natCanvas, refUrl(ctx, v), refClip(ctx, v), '--ichidan'); setRefCaption(control, v); }
  }
}
// Keep the reference waveform's caption in sync with the selected reference voice.
export function setRefCaption(control, v) {
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
export function startCursors(control) { S.cursorControl = control; if (!S.cursorRaf) S.cursorRaf = requestAnimationFrame(tickCursors); }
export function stopCursors() {
  if (S.cursorRaf) { cancelAnimationFrame(S.cursorRaf); S.cursorRaf = 0; }
  if (S.cursorControl) S.cursorControl.querySelectorAll('.rec-wave-cursor').forEach(c => { c.style.opacity = '0'; });
  S.cursorControl = null; S.activeNativeWindow = null; S.activeTakeWindow = null; S.bothPlaying = false;
}
