// Playback: the windowed <audio> player (you / reference) + normalization gains + the ▶ both bias
// + the global compare speed. Split out of the record-and-compare engine (C1.4). The reused <audio>
// elements + gains + bias live in state.js (S) — shared with the cursor loop (waveform) and the
// compare handlers (view).
//
// DEAD-ENDS preserved verbatim: windowed playback seeks/stops via a `timeupdate` listener over the
// drawn play window — NOT Media-Fragments #t= (unreliable on <audio>); the take/reference elements
// are reused <audio crossOrigin='use-credentials'> so the session cookie authorizes the gated
// cross-origin fetch (the public synth endpoint tolerates the credentialed request).
import { API_BASE } from '../../config.js';
import { clampSpeed, normGains, biasNative, biasTake, refClip } from '../../core/index.js';
import { settings, saveSettings } from '../../settings-store.js';
import { S } from './state.js';
// Forward deps used only at runtime: stopCursors/levelFor/takeUrl now live in waveform.js; refUrl in
// engine (→ view.js C1.6). Runtime-only use → the import cycles are safe (no module-eval cross-use).
import { stopCursors, levelFor, takeUrl } from './waveform.js';
import { refUrl } from './engine.js';

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
export function playTake(id, btn) {
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
export function playReference(ctx, v, window, volume, onDone) {
  const a = ensureNativeAudio();
  stopNative();
  a.src = refUrl(ctx, v);
  S.nativeStop = playRange(a, window, volume, () => { S.nativeStop = null; if (onDone) onDone(); });
}

// Stop ALL compare playback (reference + take), the cursor loop, and any lit compare buttons.
export function stopCompare(control) {
  stopCursors();
  stopNative();
  stopTake();
  if (S.takePlayingBtn) { S.takePlayingBtn.classList.remove('playing'); S.takePlayingBtn = null; }
  if (control) control.querySelectorAll('.cmp-btn.playing').forEach(b => b.classList.remove('playing'));
}

// Play a take by id over its play window (used by the compare player; no take-list button).
export function playTakeOnce(id, window, volume, onDone) {
  const a = ensureTakeAudio();
  stopTake();
  a.src = API_BASE + '/v1/audio/recordings/' + id;
  S.takeStop = playRange(a, window, volume, () => { S.takeStop = null; if (onDone) onDone(); });
}

// ---------- normalization gains + ▶ both bias + compare speed ----------
// Normalization gains for the currently-played reference/take pair (≤1, attenuate-only): bring the
// louder clip down so the two play at ~equal volume. Computed from each source's RMS over its
// spoken window; gain 1 when a level isn't known yet (buffer still decoding) or there's no pair.
export function setActiveGains(ctx, id, refV) {
  if (refV && id != null) {
    const g = normGains(levelFor(refUrl(ctx, refV), refClip(ctx, refV)), levelFor(takeUrl(id), null));
    S.activeNativeGain = g.a; S.activeTakeGain = g.b;
  } else { S.activeNativeGain = 1; S.activeTakeGain = 1; }
}

// Compare BALANCE for ▶ both: a crossfader in [-1, 1] (−1 = all you, 0 = balanced, +1 = all
// reference) that scales each side ON TOP of the normalization gains, so it's easy to lean the
// simultaneous overlay toward one voice while A/B-ing. View-only (not synced) — resets to centre on
// reload. Only affects ▶ both; live while both are sounding (S.bothPlaying). The crossfader CURVE
// (biasNative/biasTake) is pure → core/recordings.js.
function applyBothVolumes() {
  if (S.nativeAudioEl) S.nativeAudioEl.volume = clamp01(S.activeNativeGain * biasNative(S.compareBias));
  if (S.takeAudioEl) S.takeAudioEl.volume = clamp01(S.activeTakeGain * biasTake(S.compareBias));
}
export function setCompareBias(v) { S.compareBias = Math.max(-1, Math.min(1, v)); if (S.bothPlaying) applyBothVolumes(); }

// Set the global compare speed from a speed-chip click: persist + sync, repaint the chip
// active states in place (no re-render), and update any in-flight playback live. `container` is
// the element holding the speed chips (the navbar #navExtra slot).
export function setCompareSpeed(v, container) {
  settings.compareSpeed = clampSpeed(v);
  saveSettings();
  container.querySelectorAll('.speed-chip').forEach(b => {
    const on = Number(b.dataset.speed) === settings.compareSpeed;
    b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
  });
  if (S.nativeAudioEl) applySpeed(S.nativeAudioEl);
  if (S.takeAudioEl) applySpeed(S.takeAudioEl);
}
