// Text-to-speech. Preferred path: the server's Google Translate TTS proxy (GET /v1/tts),
// which gives consistent, good ja-JP audio — far better than the browser's uneven
// speechSynthesis voices. It needs a server, so we only use it when the app is served over
// http(s); over file:// (or if the request fails) we fall back to speechSynthesis. Audio is
// available if EITHER path exists (TTS_OK gates the Audio UI).
import { ttsText } from '../core/index.js';
import { playItem } from './audio.js';

export const HTTP_SERVED = location.protocol === 'http:' || location.protocol === 'https:';
export const SPEECH_OK = typeof window !== 'undefined' && 'speechSynthesis' in window;
export const TTS_OK = HTTP_SERVED || SPEECH_OK;     // is any audio available?

let jaVoice = null;
function pickVoice() {
  if (!SPEECH_OK) return;
  const vs = speechSynthesis.getVoices();
  jaVoice = vs.find(v => v.lang === 'ja-JP') || vs.find(v => v.lang && v.lang.toLowerCase().startsWith('ja')) || null;
}
// Voice list loads async in some browsers — pick now and again on change. Harmless to run
// at import (no DOM structure touched, just speechSynthesis state).
if (SPEECH_OK) { pickVoice(); speechSynthesis.addEventListener('voiceschanged', pickVoice); }

// Browser-synth fallback.
export function speakSynth(text) {
  if (!SPEECH_OK) return;
  try {
    speechSynthesis.cancel();                 // never stack/overlap utterances
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP'; u.rate = 0.9; if (jaVoice) u.voice = jaVoice;
    speechSynthesis.speak(u);
  } catch (e) {/* speech is best-effort; ignore */}
}
// speak()/speakWord() are now thin wrappers over the shared player (features/audio.js), which
// resolves the text to a tagged voice VARIANT per the caller's CONTEXT (reviews/browse/minna) and
// the user's per-context voice priority. The default context is 'browse' (the most generic). The
// player owns the <audio> element + the synth fallback; over file:// (no HTTP_SERVED) it degrades
// to speechSynthesis just like before.
export function speak(text, context = 'browse', btn, opts) {
  if (!text) return;
  playItem({ text }, context, btn, opts);
}
// ttsText (the kanji-for-accent text picker) lives in core/text.js.
export function speakWord(v, context = 'reviews', btn, opts) { speak(ttsText(v), context, btn, opts); }

// Hide the audio affordances entirely only when NO audio path is available. DOM-touching,
// so it's an init step (the elements must exist) rather than an import-time side effect.
export function initTtsUI() {
  if (TTS_OK) return;
  const ar = document.getElementById('audioRow'); if (ar) ar.style.display = 'none';
  const sb = document.getElementById('speakBtn'); if (sb) sb.style.display = 'none';
}
