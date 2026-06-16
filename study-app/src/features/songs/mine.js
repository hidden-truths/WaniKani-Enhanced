// 歌/Songs — Mine: the vocab (known/added/new vs the deck, JLPT-bucketed) + grammar panels, the
// grammar reference sub-view, save-a-line-as-a-Self-Talk-phrase, and the deep-link into Browse. Part
// of the features/songs/ package; shared mutable state in ./state.js. See REFACTOR_FOLLOWUPS.md "S".

import { api, account } from '../cloud-core.js';
import { state } from '../../state.js';
import { escapeHtml, segmentsToRuby, songWords, bucketByJlpt, songGrammar } from '../../core/index.js';
import { grammarLabel, grammarJlpt } from '../../data/grammar.js';
import { S, LV_CLASS } from './state.js';
import { known } from './library.js';
import { flash } from './index.js';

// Render the Mine panel: the song's content words bucketed by JLPT (known / added / new vs the deck,
// with per-word + bulk add) and its grammar points (each linking to the grammar reference).
export function mineHtml() {
  const s = S.openSong;
  const k = known();
  const dk = new Set(state.DATA.map((v) => v.jp)); // every deck headword (added but unstudied → 'added')
  const words = songWords(s.lines);
  const buckets = bucketByJlpt(words, k, dk);
  const newWords = words.filter((w) => !k.has(w.lemma) && !dk.has(w.lemma));
  const grams = songGrammar(s.lines);
  const badge = { known: '<span class="kn known">KNOWN</span>', added: '<span class="kn added">ADDED</span>' };
  const wordRows = buckets.map((b) => {
    const head = `<div class="lvl-head">${b.level === '?' ? 'Other' : b.level}</div>`;
    const rows = b.words.map((w) => `
      <div class="wrow"><span class="wj jp">${escapeHtml(w.lemma)}</span><span class="wr jp">${escapeHtml(w.reading || '')}</span><span class="wm">${escapeHtml(w.gloss || '')}</span>
      ${badge[w.status]
        || `<span class="kn new">NEW</span><button class="addw" data-act="addword" data-lemma="${escapeHtml(w.lemma)}" title="Add to deck"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg></button>`}</div>`).join('');
    return head + rows;
  }).join('');
  const gramRows = grams.map((g) => `
    <div class="grow" data-act="grammar" data-g="${escapeHtml(g.id)}" role="button" tabindex="0">
      <span class="gp jp">${escapeHtml(grammarLabel(g.id))}</span><span class="lv ${LV_CLASS[grammarJlpt(g.id)] || ''}">${escapeHtml(grammarJlpt(g.id) || '')}</span>
      <span class="gcount">${g.count} line${g.count === 1 ? '' : 's'}</span><svg class="ic" style="color:var(--ichidan)" aria-hidden="true"><use href="#i-chevron"/></svg></div>`).join('');
  return `
    <div class="song-head" style="align-items:center;margin-top:4px">
      <div class="song-h-sub" style="font-style:normal">${words.length} words · ${newWords.length} new to you · ${grams.length} grammar point${grams.length === 1 ? '' : 's'}</div>
      ${newWords.length ? `<button class="chip primary" data-act="addall"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg> Add ${newWords.length} new word${newWords.length === 1 ? '' : 's'}</button>` : ''}
    </div>
    <div class="vg">
      <div class="vg-card"><div class="vg-h"><svg class="ic" aria-hidden="true"><use href="#i-tag"/></svg> Words</div><div class="vg-sub">matched against your deck — known vs new</div>${wordRows || '<div class="vg-sub">No content words found.</div>'}</div>
      <div class="vg-card"><div class="vg-h"><svg class="ic" aria-hidden="true"><use href="#i-book"/></svg> Grammar</div><div class="vg-sub">tap a point for the reference + practice</div>${gramRows || '<div class="vg-sub">No grammar points tagged.</div>'}</div>
    </div>`;
}

// Render the grammar-reference sub-view (S.grammarRef): every line in this song that uses the point,
// each savable as a Self-Talk shadow phrase, plus a Browse deep-link to example sentences.
export function grammarRefHtml() {
  const s = S.openSong;
  const id = S.grammarRef;
  const usedLines = s.lines.filter((l) => (l.grammar || []).includes(id));
  const lines = usedLines.map((l) => {
    return `<div class="gref-line jp">${l.furigana ? segmentsToRuby(l.furigana) : escapeHtml(l.text)}${l.en ? `<div class="gl-en">${escapeHtml(l.en)}</div>` : ''}
      <button class="xlink" data-act="savephrase" data-ord="${l.ordinal}" style="margin-top:6px"><svg class="ic" aria-hidden="true"><use href="#i-mic"/></svg> Save as a shadow phrase</button></div>`;
  }).join('');
  return `
    <div class="gref">
      <button class="st-back" data-act="mode" data-mode="mine" style="margin-bottom:10px"><svg class="ic" aria-hidden="true"><use href="#i-back"/></svg> back to ${escapeHtml(s.title)}</button>
      <div style="display:flex;align-items:center;gap:10px"><span class="gref-pat jp">${escapeHtml(grammarLabel(id))}</span><span class="lv ${LV_CLASS[grammarJlpt(id)] || ''}">${escapeHtml(grammarJlpt(id) || '')}</span></div>
      <div class="gref-h">Used in this song · ${usedLines.length} line${usedLines.length === 1 ? '' : 's'}</div>
      ${lines || '<div class="vg-sub">No lines.</div>'}
      <div class="gref-h">Practice it</div>
      <div><button class="xlink" data-act="browse-grammar" data-g="${escapeHtml(id)}"><svg class="ic" aria-hidden="true"><use href="#i-grid"/></svg> Browse example sentences using this</button></div>
    </div>`;
}

// Save a lyric line as a private 独り言 Self-Talk shadow phrase (reuses the sentence store; no new
// SRS card type). The line already carries furigana + grammar + an English.
export async function savePhrase(ord) {
  if (!account) { document.getElementById('accountBtn').click(); return; }
  const l = S.openSong.lines[ord]; if (!l) return;
  const extId = 'usr-' + crypto.randomUUID();
  const body = {
    id: extId, text: l.text, furigana: l.furigana || null,
    translations: l.en ? { en: l.en } : undefined,
    tags: (l.grammar && l.grammar.length) ? { grammar: l.grammar } : undefined,
    link: { owner_type: 'selftalk' },
  };
  try { await api('/v1/sentences', { method: 'POST', body, retry: true }); flash('Saved to 独り言 Self-Talk'); }
  catch (e) { flash('Could not save the phrase'); }
}

// Cross-link from a song's grammar point into the Browse tab (example sentences using it).
export function goBrowseGrammar(id) {
  // Deep-link into Browse filtered to this grammar point (cross-link to example sentences).
  document.querySelector('.tab[data-tab="browse"]').click();
  // The Browse grammar facet is its own chip row; selecting it programmatically is a follow-up —
  // for now this lands the user on Browse where the グラマー chip for this id is available.
}
