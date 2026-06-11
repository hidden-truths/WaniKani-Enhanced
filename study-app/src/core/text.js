// Small pure text helpers: HTML escaping + the TTS text picker.

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// What text to hand the TTS for a card. Google TTS derives pitch accent from the WRITTEN
// form, so a kana-only reading is accent-ambiguous for homographs (橋 "bridge" vs 箸
// "chopsticks" are both はし). Sending the kanji headword lets Google apply the dictionary
// accent. Kana-only words have no kanji to send, so they use the reading. `v.tts` is an
// optional per-card override. The visible reading is always v.read regardless.
const HAS_KANJI = /[一-龯々々〆]/;
export function ttsText(v) { return v.tts || (v.jp && HAS_KANJI.test(v.jp) ? v.jp : v.read); }
