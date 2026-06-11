// Text-to-speech. Preferred path: the server's Google Translate TTS proxy (GET /v1/tts),
// which gives consistent, good ja-JP audio — far better than the browser's uneven
// speechSynthesis voices. It needs a server, so we only use it when the app is served over
// http(s); over file:// (or if the request fails) we fall back to speechSynthesis. Audio is
// available if EITHER path exists (TTS_OK gates the Audio UI).
import { API_BASE } from '../config.js';
import { ttsText } from '../core/index.js';

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
// Reused <audio> for the server path so a new play() interrupts the previous one.
let ttsAudio = null;
export function speak(text) {
  if (!text) return;
  if (SPEECH_OK) try { speechSynthesis.cancel(); } catch (e) {}   // stop any in-flight synth
  if (HTTP_SERVED) {
    try {
      if (!ttsAudio) ttsAudio = new Audio();
      ttsAudio.src = API_BASE + '/v1/tts?text=' + encodeURIComponent(text);  // public; no crossorigin attr → cross-origin media loads fine
      const p = ttsAudio.play();
      if (p && p.catch) p.catch(() => speakSynth(text));         // network/format/autoplay fail → synth
    } catch (e) { speakSynth(text); }
  } else {
    speakSynth(text);
  }
}
// ttsText (the kanji-for-accent text picker) lives in core/text.js.
export function speakWord(v) { speak(ttsText(v)); }

// Hide the audio affordances entirely only when NO audio path is available. DOM-touching,
// so it's an init step (the elements must exist) rather than an import-time side effect.
export function initTtsUI() {
  if (TTS_OK) return;
  const ar = document.getElementById('audioRow'); if (ar) ar.style.display = 'none';
  const sb = document.getElementById('speakBtn'); if (sb) sb.style.display = 'none';
}
