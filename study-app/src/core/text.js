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

// True if `s` is plain text plus ONLY well-formed <ruby>base<rt>reading</rt></ruby> furigana — no
// other tags. The save-time guard for USER-authored example sentences (the Add-card leveled editor):
// the flashcard / Browse-detail render path innerHTML's the example JP directly (exampleForLevel(v)[0]),
// so a custom card must satisfy the same clean-ruby contract the built-in/Minna `levels` already do —
// this both blocks markup injection and rejects broken ruby. Empty / plain text is clean. Pure.
const RUBY_BLOCK_STRIP = /<ruby>[^<>]*<rt>[^<>]*<\/rt><\/ruby>/g;
export function isCleanRuby(s) {
  return !/[<>]/.test(String(s).replace(RUBY_BLOCK_STRIP, ''));
}

// What text to hand the TTS for a card. Google TTS derives pitch accent from the WRITTEN
// form, so a kana-only reading is accent-ambiguous for homographs (橋 "bridge" vs 箸
// "chopsticks" are both はし). Sending the kanji headword lets Google apply the dictionary
// accent. Kana-only words have no kanji to send, so they use the reading. `v.tts` is an
// optional per-card override. The visible reading is always v.read regardless.
// Kanji detection for the TTS picker — the SINGLE source for "does this contain kanji". Also
// imported by the server's furigana-validation script (wk-enhanced-api/scripts/apply-furigana.ts)
// so the two can't drift. Covers the CJK ideograph block, the iteration marks 々/〆, and the
// counter small-ke ヶ (kanji-like: 三ヶ月). Stateless (no /g flag) → safe to share.
export const HAS_KANJI = /[一-龯々〆ヶ]/;
export function ttsText(v) { return v.tts || (v.jp && HAS_KANJI.test(v.jp) ? v.jp : v.read); }

// Strip furigana ruby back to the base sentence — drop the <rt> readings and the <ruby>
// wrappers: "<ruby>橋<rt>はし</rt></ruby>を渡る" → "橋を渡る". Used to get the plain text to
// hand a sentence to TTS, and to keep the pre-generation driver's /v1/tts key in sync
// with what the client requests (both call this, so they agree byte-for-byte).
// Also drops the Phase-4 tap-overlay `<span class="extok">` wrappers (core/annotate.js) so reading
// plainText off a span-wrapped rendered sentence still yields the bare text — span-free curated
// input (the pre-gen driver's) is unaffected, so the TTS key stays aligned.
export function plainText(s) {
  return String(s).replace(/<rt>.*?<\/rt>/g, '').replace(/<\/?ruby>/g, '').replace(/<\/?span[^>]*>/g, '');
}

// ---- structured furigana: <ruby> markup ↔ [{t, r?}] segments ----
// The unified sentence store keeps furigana as structured segments (base text `t`, optional
// reading `r`) rather than embedded markup, so it's the source of truth and the full kana
// reading is DERIVED. These helpers convert between the curated `<ruby>漢字<rt>かな</rt></ruby>`
// form the data ships in and that segment shape. Invariant: rubyToSegments(jp) maps each
// `<ruby>X<rt>Y</rt></ruby>` to {t:X, r:Y} and each run of non-ruby text to {t:'…'}, so
// segments.map(s => s.t).join('') === plainText(jp) byte-for-byte (the audio key).

const RUBY_BLOCK = /<ruby>(.*?)<rt>(.*?)<\/rt><\/ruby>/g;

// Parse curated ruby markup into [{t, r?}] segments. Pure.
export function rubyToSegments(jp) {
  const s = String(jp);
  const segs = [];
  let last = 0, m;
  RUBY_BLOCK.lastIndex = 0;
  while ((m = RUBY_BLOCK.exec(s))) {
    if (m.index > last) segs.push({ t: s.slice(last, m.index) }); // plain run before this ruby block
    segs.push(m[2] ? { t: m[1], r: m[2] } : { t: m[1] });
    last = m.index + m[0].length;
  }
  if (last < s.length) segs.push({ t: s.slice(last) }); // trailing plain run
  return segs;
}

// Rebuild the `<ruby>…</ruby>` HTML from segments. Round-trips well-formed input:
// segmentsToRuby(rubyToSegments(jp)) === jp. Pure.
export function segmentsToRuby(segs) {
  return (segs || [])
    .map((s) => (s && s.r ? `<ruby>${s.t}<rt>${s.r}</rt></ruby>` : s ? s.t : ''))
    .join('');
}

// The derived full-kana reading: each segment contributes its reading `r`, or its base `t`
// when it has none (plain kana). Pure — this is what `read` used to be stored as.
export function segmentsToReading(segs) {
  return (segs || []).map((s) => (s ? (s.r ?? s.t ?? '') : '')).join('');
}
