// Small shared render helpers used across features. Kept here to avoid feature→feature
// coupling (e.g. browse needs provenanceBadge, which is conceptually a Minna concern but
// rendered on every Browse card — importing it from minna.js would couple browse→minna).

import { escapeHtml } from '../core/index.js';

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

// Inline "copy" button markup for an example sentence (next to the ▶ speak button). Carries the
// plain (ruby-stripped) text on data-copy so a delegated/direct handler can copy it to the
// clipboard for easy lookup in a dictionary/translator. `id` is optional (static buttons that get
// wired by id); inline lists (Minna) omit it and rely on a delegated [data-copy] handler.
export function copyBtnHtml(text, id) {
  const t = String(text == null ? '' : text).replace(/"/g, '&quot;');
  return `<button class="speak-btn sm copy-btn"${id ? ` id="${id}"` : ''} type="button" data-copy="${t}" aria-label="Copy sentence" title="Copy sentence"><svg class="ic" aria-hidden="true"><use href="#i-copy"/></svg></button>`;
}

// Inline "▶ speak" button markup — the play button beside readings / examples / phrases across
// Browse, Minna, and Self-Talk (mirrors copyBtnHtml). `label` is the aria-label; `title` defaults
// to it. `cls` adds modifier classes onto the base `speak-btn` (e.g. 'sm', 'st-play'); `id` and
// `hidden` are optional. `data` is a {name: value} map → `data-<name>` attributes: a `true` value
// renders a valueless attribute (data-play), any other non-null value is attribute-escaped, and
// null/false is omitted. Playback is wired by the caller's by-id / delegated [data-*] handler.
export function speakBtnHtml({ label, title, cls = '', id, data = {}, hidden = false } = {}) {
  const idAttr = id ? ` id="${id}"` : '';
  const dataAttrs = Object.entries(data)
    .filter(([, v]) => v != null && v !== false)
    .map(([k, v]) => (v === true ? ` data-${k}` : ` data-${k}="${escapeHtml(v)}"`))
    .join('');
  return `<button class="speak-btn${cls ? ' ' + cls : ''}"${idAttr} type="button"${dataAttrs} aria-label="${label}" title="${title == null ? label : title}"${hidden ? ' hidden' : ''}><svg class="ic" aria-hidden="true"><use href="#i-play"/></svg></button>`;
}

// Copy `text` to the clipboard, with a brief ✓ confirmation on `btn` (swaps its icon to a check
// for ~1s + a .copied class). Uses the async Clipboard API where available, with an execCommand
// fallback for insecure contexts (e.g. plain http) where navigator.clipboard is absent.
export function copyText(text, btn) {
  const confirm = () => {
    if (!btn) return;
    const use = btn.querySelector('use');
    const orig = use && use.getAttribute('href');
    if (use) use.setAttribute('href', '#i-check');
    btn.classList.add('copied');
    setTimeout(() => { if (use && orig) use.setAttribute('href', orig); btn.classList.remove('copied'); }, 1100);
  };
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      confirm();
    } catch (e) {/* clipboard unavailable — give up silently */}
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(confirm).catch(fallback);
  } else {
    fallback();
  }
}
