// Pure overlay: turn structured furigana segments + GiNZA token offsets into tappable-word HTML.
//
// THE problem (Phase-4 commit 3b): annotation tokens index the PLAIN text (UTF-16 offsets into
// concat(seg.t)); the sentence renders as furigana RUBY on DIFFERENT boundaries. This helper overlays
// a `<span class="extok">` per token onto the ruby render — preserving ruby inside each span — so a tap
// maps to a token with no caret/hit-testing. The span carries the token's lemma/pos/reading in data-*,
// so the click handler is stateless (reads off the span) and survives re-renders.
//
// Contracts (pinned in test/core.test.ts):
//  • Visible text round-trips: stripping every tag from the output yields the plain text concat(seg.t).
//  • Ruby is never split (a reading is indivisible): a ruby segment is emitted WHOLE under the token
//    covering its START offset. (A reading straddling a token boundary — a rare jukujikun split by the
//    tokenizer — keeps the whole ruby in the first token; curated per-kanji ruby aligns with split-C.)
//  • Surrogate-safe: we slice only at token/segment boundaries (the offset contract guarantees those
//    are valid UTF-16 boundaries), never per-code-unit, so a non-BMP kanji (𠮟) is never torn.
//  • Everything is escaped (content + attributes) — safe even on the user-authored Self-Talk path,
//    matching that surface's existing rubyHtml policy; a no-op on the curated card text.

import { escapeHtml } from './text.js';

// UPOS tags not worth a lookup popover — rendered as plain (non-tappable) text, like a gap.
const SKIP_POS = new Set(['PUNCT', 'SYM', 'SPACE', 'X']);

function tappable(tok) {
  return !!(tok && tok.lemma && !SKIP_POS.has(tok.pos));
}

// Which token (index into `tokens`) covers character offset `off`, or -1 for a gap / no token.
function tokenIndexAt(tokens, off) {
  for (let k = 0; k < tokens.length; k++) {
    if (off >= tokens[k].start && off < tokens[k].end) return k;
  }
  return -1;
}

// In a gap (offset `a` covered by no token), where the next token starts (clamped to `end`), so the
// gap text is emitted as one bare piece up to that token.
function nextTokenStart(tokens, a, end) {
  let best = end;
  for (const t of tokens) if (t.start > a && t.start < best) best = t.start;
  return best;
}

// segments: [{t, r?}] with concat(t) === the plain text. tokens: [{i,start,end,surface,lemma,pos,
// reading,…}] with UTF-16 offsets into that same plain text. Returns HTML with a tappable span per
// (tappable) token. With no/empty tokens it degrades to plain escaped ruby (no spans) — so a caller
// can pass an unparsed sentence safely, though callers typically fall back to their own ruby render.
export function overlayTokens(segments, tokens) {
  const segs = Array.isArray(segments) ? segments : [];
  const toks = Array.isArray(tokens) ? tokens : [];

  let html = '';
  let openIdx = null; // token index of the currently-open <span>, or null if none open
  const close = () => { if (openIdx !== null) { html += '</span>'; openIdx = null; } };
  const open = (idx) => {
    if (openIdx === idx && idx >= 0) return; // same token continues — keep its span
    close();
    if (idx >= 0 && tappable(toks[idx])) {
      const t = toks[idx];
      html += `<span class="extok" data-i="${idx}" data-lemma="${escapeHtml(t.lemma)}"`
        + ` data-pos="${escapeHtml(t.pos)}" data-reading="${escapeHtml(t.reading || '')}"`
        + ` data-surface="${escapeHtml(t.surface || '')}" role="button" tabindex="0">`;
      openIdx = idx;
    } // else: gap or non-tappable token → bare text, no span (openIdx stays null)
  };

  let off = 0;
  for (const s of segs) {
    const text = s && typeof s.t === 'string' ? s.t : '';
    const segStart = off, segEnd = off + text.length;
    if (s && s.r) {
      // Ruby is indivisible — emit whole under the token covering its start offset.
      open(tokenIndexAt(toks, segStart));
      html += `<ruby>${escapeHtml(text)}<rt>${escapeHtml(s.r)}</rt></ruby>`;
    } else {
      // Plain run: break only at token boundaries inside the segment (valid UTF-16 boundaries).
      let a = segStart;
      while (a < segEnd) {
        const idx = tokenIndexAt(toks, a);
        const b = idx >= 0 ? Math.min(toks[idx].end, segEnd) : nextTokenStart(toks, a, segEnd);
        open(idx);
        html += escapeHtml(text.slice(a - segStart, b - segStart));
        a = b;
      }
    }
    off = segEnd;
  }
  close();
  return html;
}
