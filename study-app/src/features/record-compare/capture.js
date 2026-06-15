// Capture: microphone selection + the persistent speaking-mode stream + the MediaRecorder lifecycle
// + silence trim + the post-take review panel. Split out of the record-and-compare engine (C1.2).
//
// Its singletons (speakingMode/liveStream/active/selectedMicId/micDevices) are LOCAL — no other
// module mutates them; consumers read the speaking state via isSpeakingMode(). DEAD-ENDS preserved:
// the AirPods-HFP non-AirPods deviceId:{exact} pin (DEVICE-LOCAL, localStorage, NOT synced); ONE
// persistent liveStream for all takes (no getUserMedia per take — avoids the macOS renegotiation
// hitch + the AirPods A2DP→HFP flip); the devicechange listener attaches once.
import { setSyncStatus } from '../cloud-core.js';
import { settings } from '../../settings-store.js';
import { escapeHtml, findTrimBounds, encodeWav, chooseMime, RECORD_MIME_CANDIDATES } from '../../core/index.js';
import { audioCtx } from './state.js';
// Forward deps on the not-yet-peeled remainder; repointed as those peel (uploadTake → takes.js C1.3,
// resetControl → view.js C1.6). Runtime-only use (inside showReview), so the engine⇄capture import
// cycle is safe — nothing here runs at module-eval time.
import { uploadTake, resetControl } from './engine.js';

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
// to 16-bit PCM WAV (encodeWav, pure). Gated by the `trimSilence` setting; any failure (decode
// unsupported, all-silence, too-short) falls back to the untouched original.
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

// ---------- speaking-bar mic <select> ----------
// micOptionsHtml is consumed by the speaking bar (view.speakingBarHtml), hence exported.
export function micOptionsHtml() {
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

// ---------- MediaRecorder lifecycle (one active recording at a time) ----------
// start/stopRecording are exported (view.wireRecordCompare drives them); showReview is local.
let active = null;   // { control, recorder, chunks, mime, startedAt }
// Records from the PERSISTENT speaking-mode stream — no getUserMedia per take, so there's no
// per-take device renegotiation hitch. Only callable while speaking mode holds the stream.
export function startRecording(control) {
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
export function stopRecording() { if (active && active.recorder.state !== 'inactive') active.recorder.stop(); }

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
