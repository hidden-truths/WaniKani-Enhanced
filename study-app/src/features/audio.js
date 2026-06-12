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
import { resolveVariant } from '../core/index.js';
import { speakSynth, HTTP_SERVED, SPEECH_OK } from './tts.js';

// Two reused elements: one public (synth), one credentialed (gated native/user). Reused so a new
// play() interrupts the previous one; created lazily (no DOM work at import).
let pubAudio = null, gatedAudio = null;
function pub() { if (!pubAudio) pubAudio = new Audio(); return pubAudio; }
function gated() { if (!gatedAudio) { gatedAudio = new Audio(); gatedAudio.crossOrigin = 'use-credentials'; } return gatedAudio; }

let curBtn = null;
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

// Play `item` for a UI `context` ('reviews'|'browse'|'minna'). `item` declares what voices it can
// offer: { text? } (synth), { native? } (a vnjpclub path), { takeId? } (a recording id) — any subset.
// `btn` (optional) is the play button: it gets a `.playing` class while sounding, and clicking the
// same lit button again toggles playback off.
export function playItem(item, context, btn) {
  if (!item) return;
  const wasPlayingThis = btn && btn === curBtn;
  stopEls();
  clearBtn();
  if (wasPlayingThis) return;   // toggle-off

  const text = item.text || '';
  const available = { tts: HTTP_SERVED && !!text, native: !!item.native, user: item.takeId != null };
  if (!available.tts && !available.native && !available.user) { if (text) speakSynth(text); return; }
  const chosen = resolveVariant(context, available, settings.audioPrefs);
  if (!chosen) { if (text) speakSynth(text); return; }
  startVariant(chosen, item, context, btn);
}
