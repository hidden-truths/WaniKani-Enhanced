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
import { settings } from '../../settings-store.js';
import {
  escapeHtml, formatDuration, validClip, clampSpeed, COMPARE_SPEEDS,
  // pure record-compare helpers extracted to core (C0) — direct (no binding):
  biasNative, biasTake, refClip, refVariantId, refShortLabel, parseControlCtx,
  // …and the base/httpServed/prefs-injected ones, wrapped below to keep their feature-local signatures
  // (core's nativeUrl is reached transitively via refUrl, so it isn't imported here):
  refUrl as coreRefUrl,
  referenceVariants as coreReferenceVariants, defaultRef as coreDefaultRef, currentRef as coreCurrentRef,
} from '../../core/index.js';
import { HTTP_SERVED } from '../tts.js';
import { cycleMod } from '../audio.js';
import { S } from './state.js';   // shared mutable singletons (audioCtx now used only by waveform/capture)
import { RECORD_SUPPORTED, isSpeakingMode, micOptionsHtml, startRecording, stopRecording } from './capture.js';
import { takesFor, newestTakeId, deleteTake } from './takes.js';
import { playTake, playTakeOnce, playReference, stopCompare, setActiveGains, setCompareBias, setCompareSpeed } from './playback.js';
import { WAVE_W, WAVE_H, takeUrl, windowFor, startCursors, stopCursors, paintControlWaves, setRefCaption } from './waveform.js';

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

// clamp01 / applySpeed / playRange (windowed <audio>) / take + reference playback / stopCompare /
// playTakeOnce → ./playback.js. engine imports the few its view/wiring need (see playback import).

// ---------- dual waveform (decode → canvas) + live playback cursor → ./waveform.js ----------
// (WAVE_W/H, COMPARE_TRIM, the decode caches, takeUrl, fetch/window/level, draw/paint, the cursor rAF)
// engine imports the few its view/wiring need (see the waveform import above).

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
export function controlCtx(control) { return parseControlCtx(control.dataset); }   // exported for waveform.js; moves to view.js (C1.6)

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
export function currentRef(control, ctx) { return coreCurrentRef(control.dataset.ref || '', ctx, HTTP_SERVED, settings.audioPrefs); }   // exported for waveform.js; moves to view.js (C1.6)
// Playback URL for a reference variant: native is the gated proxy (sliced by refClip's line clip); a
// synth voice is the public tagged-TTS endpoint (no clip — windowFor trims its silence).
export function refUrl(ctx, v) { return coreRefUrl(API_BASE, ctx, v); }   // exported for playback.js; moves to view.js (C1.6)

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

// setActiveGains (normalization) / applyBothVolumes / setCompareBias (▶ both crossfader) → ./playback.js.

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

// setCompareSpeed → ./playback.js.

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
