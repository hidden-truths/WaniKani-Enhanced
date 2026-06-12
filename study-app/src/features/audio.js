// Shared audio player (audio-unify Phase 2). ONE entry point — playItem(item, context, btn) —
// behind which every play button resolves its item to a tagged voice VARIANT (per the user's
// per-context priority, see core/audio.js resolveVariant) and plays it through the right <audio>:
//
//   • synth (Siri/Google) is PUBLIC  → a plain reused <audio>, served from /v1/audio/tts?voice=
//   • native + user takes are GATED  → a credentialed <audio crossOrigin='use-credentials'>,
//     served from /v1/audio/native + /v1/audio/recordings (cookie-authorized cross-origin)
//
// so gated personal/copyrighted bytes never ride the public path. On a playback error it cascades
// (a failed gated source → synth; failed synth → the browser's speechSynthesis), so audio is
// best-effort and a missing variant never leaves the user with nothing.
import { API_BASE } from '../config.js';
import { settings } from '../settings-store.js';
import { resolveVariant, variantOrder, variantIndex } from '../core/index.js';
import { speakSynth, HTTP_SERVED, SPEECH_OK } from './tts.js';

// Two reused elements: one public (synth), one credentialed (gated native/user). Reused so a new
// play() interrupts the previous one; created lazily (no DOM work at import).
let pubAudio = null, gatedAudio = null;
function pub() { if (!pubAudio) pubAudio = new Audio(); return pubAudio; }
function gated() { if (!gatedAudio) { gatedAudio = new Audio(); gatedAudio.crossOrigin = 'use-credentials'; } return gatedAudio; }

let curBtn = null;
// Per-item "try another voice" cursor (follow-up ③). A modifier-click advances through the item's
// variantOrder(); a plain play resets the cursor to wherever the default landed, so cycling always
// steps AWAY from the current default. Keyed by item identity so switching items restarts the walk.
let cycleKey = null, cycleIdx = -1;
function itemKey(item) { return [item.text || '', item.native || '', item.takeId == null ? '' : item.takeId].join('|'); }
// True when the click asked to cycle (Alt/Option- or Shift-click). Exported so call sites stay terse.
export function cycleMod(e) { return !!(e && (e.altKey || e.shiftKey)); }
function stopEls() {
  [pubAudio, gatedAudio].forEach((a) => { if (a) { try { a.pause(); } catch (e) {} a.onended = a.onerror = null; } });
  if (SPEECH_OK) { try { speechSynthesis.cancel(); } catch (e) {} }   // stop any in-flight synth fallback
}
function clearBtn() { if (curBtn) curBtn.classList.remove('playing'); curBtn = null; }

// Playback URL for a resolved variant. Synth carries the chosen voice tag (the server falls through
// to the default clip if that voice isn't pre-generated); native/user are the gated sources.
function urlFor(chosen, item) {
  if (chosen.kind === 'tts') return API_BASE + '/v1/audio/tts?text=' + encodeURIComponent(item.text) + (chosen.voice ? '&voice=' + encodeURIComponent(chosen.voice) : '');
  if (chosen.kind === 'native') return API_BASE + '/v1/audio/native?src=' + encodeURIComponent(item.native);
  if (chosen.kind === 'user') return API_BASE + '/v1/audio/recordings/' + item.takeId;
  return '';
}

function startVariant(chosen, item, context, btn) {
  const el = chosen.kind === 'tts' ? pub() : gated();
  curBtn = btn || null;
  if (btn) btn.classList.add('playing');
  el.onended = () => { clearBtn(); };
  el.onerror = () => { clearBtn(); fallback(chosen, item); };
  el.src = urlFor(chosen, item);
  el.play().catch(() => { clearBtn(); fallback(chosen, item); });
}

// A gated source failed but we have text → try synth; a synth source failed → speechSynthesis.
function fallback(chosen, item) {
  if (chosen.kind !== 'tts' && item.text && HTTP_SERVED) { startVariant({ kind: 'tts', voice: 'google' }, item, null, null); return; }
  if (item.text) speakSynth(item.text);
}

// A sample word for auditioning a voice in Settings (the Voice-priority editor's ▶ buttons).
export const PREVIEW_SAMPLE = '食べる';

// Which SPECIFIC synth voices the server has actually pre-generated, as a Set of voice ids (for the
// picker's availability hinting, follow-up ④). The /v1/audio/variants catalog lists the manifest's
// real clips (Siri male/female once generated) + an always-available `google`; a palette voice
// absent here isn't generated yet (it would fall through to the Google clip). Public endpoint, no
// credentials. Returns null on any failure so the caller FAILS OPEN (no dimming when we can't tell).
export async function fetchAvailableVoices(text = PREVIEW_SAMPLE) {
  try {
    const r = await fetch(API_BASE + '/v1/audio/variants?text=' + encodeURIComponent(text));
    if (!r.ok) return null;
    const j = await r.json();
    return new Set((j.variants || []).filter((v) => v.available !== false).map((v) => v.id));
  } catch (e) { return null; }
}

// Audition a SPECIFIC synth voice on the sample word, bypassing the resolver — the Settings
// voice-priority editor uses this so the user can hear exactly the voice they're ordering. (Native /
// user kinds have no sample for an arbitrary word, so the editor only calls this for synth voices.)
// Same toggle + `.playing` semantics as playItem; on a non-HTTP page it falls back to speechSynthesis.
export function previewVoice(voiceId, btn) {
  const item = { text: PREVIEW_SAMPLE };
  const wasPlayingThis = btn && btn === curBtn;
  stopEls();
  clearBtn();
  if (wasPlayingThis) return;   // toggle-off
  if (!HTTP_SERVED) { speakSynth(item.text); return; }
  startVariant({ kind: 'tts', voice: voiceId }, item, null, btn);
}

// Play `item` for a UI `context` ('reviews'|'browse'|'minna'). `item` declares what voices it can
// offer: { text? } (synth), { native? } (a vnjpclub path), { takeId? } (a recording id) — any subset.
// `btn` (optional) is the play button: it gets a `.playing` class while sounding, and clicking the
// same lit button again toggles playback off.
export function playItem(item, context, btn, opts) {
  if (!item) return;
  const cycle = !!(opts && opts.cycle);
  const wasPlayingThis = btn && btn === curBtn;
  stopEls();
  clearBtn();
  if (wasPlayingThis && !cycle) return;   // plain re-click on the lit button → toggle off (cycle advances instead)

  const text = item.text || '';
  const available = { tts: HTTP_SERVED && !!text, native: !!item.native, user: item.takeId != null };
  if (!available.tts && !available.native && !available.user) { if (text) speakSynth(text); return; }
  const def = resolveVariant(context, available, settings.audioPrefs);
  if (!def) { if (text) speakSynth(text); return; }

  const key = itemKey(item);
  const list = variantOrder(available);
  if (cycle && list.length > 1) {
    // Advance from wherever the cursor is — seeded at the default for a fresh item — to the next voice.
    if (cycleKey !== key) cycleIdx = variantIndex(list, def);
    cycleIdx = (cycleIdx + 1) % list.length;
    cycleKey = key;
    const chosen = list[cycleIdx];
    if (btn) btn.title = 'Voice: ' + chosen.label + ' — ⌥/⇧-click to try another';
    startVariant(chosen, item, context, btn);
    return;
  }
  // Plain play (or nothing to cycle): play the default, and remember its slot so a following
  // modifier-click steps off it. Surface the cycle hint on a button that has alternatives.
  cycleKey = key; cycleIdx = variantIndex(list, def);
  if (btn && list.length > 1) btn.title = 'Play — ⌥/⇧-click to try another voice';
  startVariant(def, item, context, btn);
}
