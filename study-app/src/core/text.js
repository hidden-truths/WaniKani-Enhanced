// Small pure text helpers: HTML escaping + the TTS text picker.

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Render curated Japanese that MAY carry furigana ruby. Like escapeHtml, but lets the
// ruby tag set (<ruby>/<rt>/<rp>) pass through so the global `data-furigana` flip can
// hide/show the <rt> readings — everything else is escaped, so a malformed lesson entry
// can't inject markup. Plain text (no ruby) round-trips identically to escapeHtml. Used
// for the みんなの日本語 example/conversation sentences (the vocab `levels` already ship ruby).
const RUBY_TAG = /<\/?(?:ruby|rt|rp)>/gi;
export function rubyHtml(s) {
  s = String(s);
  let out = '', last = 0, m;
  RUBY_TAG.lastIndex = 0;
  while ((m = RUBY_TAG.exec(s))) {
    out += escapeHtml(s.slice(last, m.index)) + m[0].toLowerCase();
    last = m.index + m[0].length;
  }
  return out + escapeHtml(s.slice(last));
}

// What text to hand the TTS for a card. Google TTS derives pitch accent from the WRITTEN
// form, so a kana-only reading is accent-ambiguous for homographs (橋 "bridge" vs 箸
// "chopsticks" are both はし). Sending the kanji headword lets Google apply the dictionary
// accent. Kana-only words have no kanji to send, so they use the reading. `v.tts` is an
// optional per-card override. The visible reading is always v.read regardless.
const HAS_KANJI = /[一-龯々々〆]/;
export function ttsText(v) { return v.tts || (v.jp && HAS_KANJI.test(v.jp) ? v.jp : v.read); }

// Strip furigana ruby back to the base sentence — drop the <rt> readings and the <ruby>
// wrappers: "<ruby>橋<rt>はし</rt></ruby>を渡る" → "橋を渡る". Used to get the plain text to
// hand a sentence to TTS, and to keep the pre-generation driver's /v1/tts key in sync
// with what the client requests (both call this, so they agree byte-for-byte).
export function plainText(s) {
  return String(s).replace(/<rt>.*?<\/rt>/g, '').replace(/<\/?ruby>/g, '');
}
