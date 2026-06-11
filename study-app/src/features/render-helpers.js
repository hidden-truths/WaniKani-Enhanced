// Small shared render helpers used across features. Kept here to avoid feature→feature
// coupling (e.g. browse needs provenanceBadge, which is conceptually a Minna concern but
// rendered on every Browse card — importing it from minna.js would couple browse→minna).

// Jisho.org dictionary deep-link for a headword. Shown on the flashcard answer side and in
// the Browse detail modal. encodeURIComponent keeps kanji/kana valid in the URL path
// (e.g. 食べる → /word/%E9%A3%9F%E3%81%B9%E3%82%8B).
export function jishoUrl(jp) { return 'https://jisho.org/word/' + encodeURIComponent(jp); }

// Browse provenance badge: みんなの日本語 cards show it over the plain CUSTOM badge.
export function provenanceBadge(v) {
  if (v && v.minna) return `<div class="minna-badge">みんなの日本語${v.minnaLesson ? ' · L' + v.minnaLesson : ''}</div>`;
  if (v && v.custom) return '<div class="custom-badge">CUSTOM</div>';
  return '';
}
