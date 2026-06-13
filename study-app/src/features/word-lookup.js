// Tap-a-word lookup popover (Phase-4 commit 3b). The example-sentence overlay (core/annotate.js)
// renders each token as a `<span class="extok" data-lemma data-pos data-reading data-surface>`. This
// module wires a delegated tap on a STABLE container so taps survive the per-card/per-render innerHTML
// swaps, and shows a small popover: surface + reading + part-of-speech, with an action that resolves
// the token's LEMMA (dictionary form) against the deck — open that card's detail (openVerbDetail), else
// a Jisho deep-link. Stateless: everything comes off the clicked span, so re-renders can't stale it.
//
// browse⇄word-lookup is a runtime (event-time) import cycle, which is fine here — the live binding is
// only read inside the click handler, never at module eval (same pattern as cloud⇄minna).

import { state } from '../state.js';
import { escapeHtml } from '../core/index.js';
import { jishoUrl } from './render-helpers.js';
import { openVerbDetail } from './browse.js';

// GiNZA UPOS → a short human label for the popover. Unknown tags fall back to the raw tag.
const POS_LABEL = {
  NOUN: 'Noun', PROPN: 'Proper noun', VERB: 'Verb', AUX: 'Auxiliary', ADJ: 'Adjective',
  ADV: 'Adverb', PRON: 'Pronoun', ADP: 'Particle', PART: 'Particle', DET: 'Determiner',
  CCONJ: 'Conjunction', SCONJ: 'Conjunction', NUM: 'Number', INTJ: 'Interjection',
  SYM: 'Symbol', PUNCT: 'Punctuation', X: 'Other',
};

// Katakana → hiragana, so the GiNZA reading (katakana) shows in the app's hiragana-first style.
function toHiragana(s) {
  return String(s || '').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

// Resolve a dictionary-form lemma to a deck card: built-in fast path (BUILTIN_RANK_BY_JP), then any
// card (custom / みんなの日本語) by headword. Null → no card, caller falls back to Jisho.
function resolveCard(lemma) {
  if (!lemma) return null;
  const rank = state.BUILTIN_RANK_BY_JP[lemma];
  if (rank != null) {
    const v = (state.DATA || []).find((c) => c.rank === rank);
    if (v) return v;
  }
  return (state.DATA || []).find((c) => c.jp === lemma) || null;
}

let popEl = null;

function closePopover() {
  if (!popEl) return;
  popEl.remove();
  popEl = null;
  document.removeEventListener('click', onDocClick, true);
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('scroll', closePopover, true);
  window.removeEventListener('resize', closePopover, true);
}

function onDocClick(e) {
  if (popEl && !popEl.contains(e.target) && !(e.target.closest && e.target.closest('.extok'))) closePopover();
}
function onKey(e) {
  if (e.key === 'Escape') closePopover();
}

function showPopover(span) {
  closePopover();
  const lemma = span.dataset.lemma || span.dataset.surface || '';
  const surface = span.dataset.surface || lemma;
  const pos = POS_LABEL[span.dataset.pos] || span.dataset.pos || '';
  const reading = toHiragana(span.dataset.reading);
  const card = resolveCard(lemma);
  // Headword line: the surface as tapped, with its reading; show the dictionary form only when it
  // differs (a conjugated token like 食べて → lemma 食べる).
  const readChip = reading && reading !== surface ? `<span class="wl-read jp">${escapeHtml(reading)}</span>` : '';
  const lemmaChip = lemma && lemma !== surface ? `<div class="wl-lemma">→ <span class="jp">${escapeHtml(lemma)}</span></div>` : '';
  const action = card
    ? `<button class="wl-act" type="button" data-wl-card>Open card →</button>`
    : `<a class="wl-act" href="${jishoUrl(lemma)}" target="_blank" rel="noopener">Jisho ↗</a>`;

  popEl = document.createElement('div');
  popEl.className = 'word-pop';
  popEl.innerHTML = `
    <div class="wl-head"><span class="wl-surface jp">${escapeHtml(surface)}</span>${readChip}</div>
    ${lemmaChip}
    <div class="wl-pos">${escapeHtml(pos)}</div>
    <div class="wl-actions">${action}</div>`;
  document.body.appendChild(popEl);

  // Position just below the word; clamp into the viewport, flip above if it would overflow the bottom.
  const r = span.getBoundingClientRect();
  const pw = popEl.offsetWidth, ph = popEl.offsetHeight;
  const margin = 8;
  let left = r.left + window.scrollX;
  left = Math.max(window.scrollX + margin, Math.min(left, window.scrollX + document.documentElement.clientWidth - pw - margin));
  let top = r.bottom + window.scrollY + 6;
  if (r.bottom + ph + 6 > document.documentElement.clientHeight) top = r.top + window.scrollY - ph - 6;
  popEl.style.left = `${left}px`;
  popEl.style.top = `${Math.max(window.scrollY + margin, top)}px`;

  if (card) {
    popEl.querySelector('[data-wl-card]').addEventListener('click', () => { closePopover(); openVerbDetail(card); });
  }
  // Defer the dismiss listeners so the click that opened the popover doesn't immediately close it.
  setTimeout(() => {
    if (!popEl) return;
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', closePopover, true);
    window.addEventListener('resize', closePopover, true);
  }, 0);
}

// Wire a STABLE container so taps (and Enter/Space) on its `.extok` words open the lookup popover.
// Delegated + idempotent per element, so re-rendering the container's innerHTML keeps it working.
export function wireWordTaps(container) {
  if (!container || container._wlWired) return;
  container._wlWired = true;
  container.addEventListener('click', (e) => {
    const span = e.target.closest && e.target.closest('.extok');
    if (span && container.contains(span)) showPopover(span);
  });
  container.addEventListener('keydown', (e) => {
    const span = e.target.classList && e.target.classList.contains('extok') ? e.target : null;
    if (span && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); showPopover(span); }
  });
}
