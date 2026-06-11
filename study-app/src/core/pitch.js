// Pitch accent (visual). `accent` is the Tokyo-dialect drop position — 0 = heiban (no drop
// in the word), 1 = atamadaka (drop after mora 1), k = drop after the kth mora. We render
// the reading mora-by-mora with an overline over the HIGH morae and a step-down at the
// drop, so the correct pitch is VISIBLE even though Google's synthesized audio can't
// reproduce it. No accent data → just the (escaped) reading, unchanged.
import { escapeHtml } from './text.js';

const SMALL_KANA = /[ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ]/;
export function splitMora(s) {
  const m = [];
  for (const ch of (s || '')) { if (m.length && SMALL_KANA.test(ch)) m[m.length - 1] += ch; else m.push(ch); }
  return m;
}
export function pitchHtml(reading, accent) {
  if (accent == null || accent === '' || !reading) return escapeHtml(reading || '');
  const a = +accent, mora = splitMora(reading), n = mora.length;
  let html = '';
  for (let i = 0; i < n; i++) {
    const pos = i + 1;
    const hi = a === 0 ? pos !== 1 : a === 1 ? pos === 1 : (pos !== 1 && pos <= a);
    const drop = a > 0 && pos === a;            // pitch falls AFTER this mora
    html += `<span class="pa${hi ? ' hi' : ''}${drop ? ' drop' : ''}">${escapeHtml(mora[i])}</span>`;
  }
  return `<span class="pitch" title="pitch accent [${a}]">${html}</span>`;
}
