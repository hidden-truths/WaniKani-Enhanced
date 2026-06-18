// BROWSE — the reference grid. Independent filter state (bcfg) from the study deck, but
// evaluated by the same passes() predicate, plus a free-text search over reading/kanji/
// meaning. Clicking a card opens the detail MODAL (openVerbDetail), not an inline expand.
import { state } from '../state.js';
import {
  passes, isLeech, rollingAcc, colorClass, cardStamp, pitchHtml, escapeHtml, plainText,
  availableTiers, exampleForLevel, JLPT_TIERS, BOX_COLORS, nextDueLabel, filterSummary, overlayTokens,
  cardGrammar, cardMatchesGrammar,
} from '../core/index.js';
import { settings } from '../settings-store.js';
import { speakWord, speak, TTS_OK } from './tts.js';
import { cycleMod } from './audio.js';
import { jishoUrl, provenanceBadge, copyText, speakBtnHtml } from './render-helpers.js';
import { wireWordTaps } from './word-lookup.js';
import { grammarLabel, grammarJlpt, orderGrammar } from '../data/grammar.js';
import { makeMultiSelect, wireFacets, paintSummary, syncVerbRows } from './deck.js';

// Browse grid filter — OWNED here. Same facet shape as cfg; mutated in place, never
// reassigned. rmax finalized to state.MAXRANK in initBrowseUI (not built at import).
export const bcfg = { cat: [], type: [], trans: [], topic: [], status: [], source: [], jlpt: ['all'], rmin: 1, rmax: 100 };

// Custom-card actions (Edit/Delete in the detail modal) live in custom-cards.js; injected to
// avoid a browse↔custom-cards import cycle. Registered at boot.
let openVerbModal = () => {};
let deleteVerb = () => {};
export function registerCardActions(h) { if (h.openVerbModal) openVerbModal = h.openVerbModal; if (h.deleteVerb) deleteVerb = h.deleteVerb; }

let repaintBrowse = () => {};
let detailVerb = null, detailLevel = null;

/* Collapsible disclosure groups: the Topic chips AND the dynamically-rendered Grammar chips.
   The chips inside stay wired by their own class + data-* (makeMultiSelect / the grammar
   delegate ignore DOM nesting); this only toggles a max-height region and keeps a live "· N"
   badge on the toggle. A MutationObserver on the region (class + childList) keeps the badge
   correct when selections change programmatically AND when renderGrammarChips rebuilds the
   chip DOM. Open state persists per-panel. */
function setupTopicGroups() {
  document.querySelectorAll('.topic-toggle').forEach(btn => {
    const region = document.getElementById(btn.dataset.target);
    if (!region) return;
    const base = btn.dataset.label || 'Topics', txt = btn.querySelector('.tt-text');
    const key = 'jpverbs_topic_' + btn.dataset.target;
    function setOpen(open) {
      region.classList.toggle('open', open);
      btn.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    function refresh() {
      const n = region.querySelectorAll('.chip.active').length;
      txt.textContent = n ? base + ' · ' + n : base;
      btn.classList.toggle('has-active', n > 0);
    }
    btn.addEventListener('click', () => {
      const open = !region.classList.contains('open');
      setOpen(open); localStorage.setItem(key, open ? '1' : '0');
    });
    new MutationObserver(refresh).observe(region, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    setOpen(localStorage.getItem(key) === '1');
    refresh();
  });
}

/* ---- Browse detail modal ----
   Core identity always shown; Mnemonic / Trap-tip / Example sentences are collapsible
   <details>. The Examples section is JLPT-level-filtered (a LOCAL view, doesn't change the
   global default). detailVerb/detailLevel hold the open modal's state. */
// Visual SRS status: a 5-segment Leitner track + box number + a "next review" chip that
// flips to "due now" once due. New/unseen cards get a plain new-card line.
function detailMemoryLine(v) {
  const c = state.store.cards[v.rank];
  if (!c || !c.box) return '<div class="det-memory new"><svg class="ic" aria-hidden="true"><use href="#i-cards"/></svg>New — not yet reviewed</div>';
  const box = c.box;
  const pips = [1, 2, 3, 4, 5].map(b => `<span class="srs-pip${b <= box ? ' on' : ''}"${b <= box ? ` style="background:${BOX_COLORS[b]}"` : ''}></span>`).join('');
  const due = Date.now() >= (c.due || 0);
  return `<div class="det-memory" role="img" aria-label="Spaced-repetition box ${box} of 5, next review ${due ? 'due now' : nextDueLabel(v.rank)}">
    <span class="srs-track">${pips}</span>
    <span class="srs-boxn">Box ${box}<small>&#8202;/&#8202;5</small></span>
    <span class="srs-due${due ? ' now' : ''}"><svg class="ic" aria-hidden="true"><use href="#i-clock"/></svg>${due ? 'due now' : nextDueLabel(v.rank)}</span>
  </div>`;
}
function renderDetailExample() {
  const v = detailVerb, seg = document.getElementById('dExLevels'); if (!v || !seg) return;
  const tiers = availableTiers(v);
  let lvl = detailLevel || settings.exampleLevel;
  if (tiers.length) {
    if (!tiers.includes(lvl)) lvl = tiers.includes(v.jlpt) ? v.jlpt : tiers[0];
    seg.style.display = '';
    seg.innerHTML = JLPT_TIERS.map(t => `<button class="chip exlv" type="button" data-exlv="${t}"${tiers.includes(t) ? '' : ' disabled'}>${t}</button>`).join('');
  } else { seg.style.display = 'none'; seg.innerHTML = ''; }
  detailLevel = lvl;
  [...seg.querySelectorAll('.exlv')].forEach(b => b.classList.toggle('active', b.dataset.exlv === lvl && !b.disabled));
  const ex = exampleForLevel(v, lvl), jp = document.getElementById('dExJp'), en = document.getElementById('dExEn'), gram = document.getElementById('dExGram');
  if (ex) {
    // Tappable word overlay when the example carries a GiNZA annotation (ex[2].tokens), else plain ruby.
    const meta = ex[2];
    jp.innerHTML = meta && meta.tokens && meta.furigana ? overlayTokens(meta.furigana, meta.tokens) : ex[0];
    wireWordTaps(jp);
    en.textContent = ex[1];
    // Surface this sentence's grammar points (read-only chips) — discoverability for the Browse filter.
    const gs = (meta && meta.grammar) || [];
    if (gram) gram.innerHTML = gs.length ? `Grammar: ${gs.map((g) => `<span class="ex-gram-chip" title="${escapeHtml(grammarJlpt(g))} grammar">${escapeHtml(grammarLabel(g))}</span>`).join('')}` : '';
  } else { jp.textContent = 'No example yet.'; en.textContent = ''; if (gram) gram.innerHTML = ''; }
  const sp = document.getElementById('dExSpeak'); if (sp) sp.hidden = !ex;   // play the shown tier
  const cp = document.getElementById('dExCopy'); if (cp) cp.hidden = !ex;    // copy the shown tier
}
export function openVerbDetail(v) {
  detailVerb = v; detailLevel = null;
  const tiLabel = v.trans === 't' ? 'transitive' : (v.trans === 'i' ? 'intransitive' : '');
  const tags = `${tiLabel ? `<span class="tag" style="color:var(--ichidan)">${tiLabel}</span>` : ''}${v.tags.filter(t => !t.startsWith('top')).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}`;
  document.getElementById('detailBody').innerHTML = `
    <div class="card-top"><div>
      <div class="verb-jp jp" style="font-size:34px">${v.jp}</div>
      <div class="verb-reading">${pitchHtml(v.read, v.accent)}${TTS_OK ? ` ${speakBtnHtml({ cls: 'sm', id: 'dSpeak', label: 'Play reading' })}` : ''}</div>
      <div class="verb-meaning">${v.mean}</div>
      <a class="jisho-link" target="_blank" rel="noopener noreferrer" href="${jishoUrl(v.jp)}"><svg class="ic" aria-hidden="true"><use href="#i-external"/></svg>View on Jisho</a></div>
      <div style="text-align:right"><div class="stamp ${cardStamp(v).cls}">${cardStamp(v).label}</div><div class="jlpt-pill">${v.jlpt}</div>${provenanceBadge(v)}</div></div>
    ${isLeech(v.rank) ? '<span class="leech-badge">⚠ LEECH</span>' : ''}
    <div class="tags">${tags}</div>
    ${detailMemoryLine(v)}
    ${v.mnem ? `<details open><summary>Mnemonic</summary><div class="det-body">${v.mnem}</div></details>` : ''}
    ${v.tip ? `<details><summary>Trap / tip</summary><div class="det-body">${v.tip}</div></details>` : ''}
    <details><summary>Example sentences</summary><div class="det-body">
      <span class="jlptseg exseg" id="dExLevels" role="group" aria-label="Example level"></span>${TTS_OK ? `${speakBtnHtml({ cls: 'sm', id: 'dExSpeak', label: 'Play example sentence', hidden: true })}` : ''}<button class="speak-btn sm copy-btn" id="dExCopy" type="button" aria-label="Copy sentence" title="Copy sentence" hidden><svg class="ic" aria-hidden="true"><use href="#i-copy"/></svg></button>
      <div class="ex-jp jp" id="dExJp" style="margin-top:8px"></div><div class="ex-en" id="dExEn"></div><div class="ex-grammar" id="dExGram"></div>
    </div></details>
    ${v.custom ? `<div class="verb-actions"><button class="chip" id="dEdit" type="button"><svg class="ic" aria-hidden="true"><use href="#i-edit"/></svg>Edit</button><button class="chip" id="dDel" type="button" style="border-color:var(--godan);color:var(--godan)"><svg class="ic" aria-hidden="true"><use href="#i-trash"/></svg>Delete</button></div>` : ''}`;
  renderDetailExample();
  const sp = document.getElementById('dSpeak'); if (sp) sp.addEventListener('click', (e) => speakWord(v, 'browse', sp, { cycle: cycleMod(e) }));
  const exsp = document.getElementById('dExSpeak'); if (exsp) exsp.addEventListener('click', (e) => speak(plainText(document.getElementById('dExJp').innerHTML), 'browse', exsp, { cycle: cycleMod(e) }));
  const excp = document.getElementById('dExCopy'); if (excp) excp.addEventListener('click', () => copyText(plainText(document.getElementById('dExJp').innerHTML), excp));
  const seg = document.getElementById('dExLevels'); if (seg) seg.addEventListener('click', e => { const b = e.target.closest('.exlv'); if (!b || b.disabled) return; detailLevel = b.dataset.exlv; renderDetailExample(); });
  if (v.custom) {
    const eb = document.getElementById('dEdit'), db = document.getElementById('dDel');
    if (eb) eb.addEventListener('click', () => { closeDetail(); openVerbModal(v); });
    if (db) db.addEventListener('click', () => { if (confirm('Delete custom card ' + v.jp + '? Its progress is also removed.')) { closeDetail(); deleteVerb(v.rank); } });
  }
  document.getElementById('detailModal').classList.add('show');
}
function closeDetail() { document.getElementById('detailModal').classList.remove('show'); }

// ---- grammar facet (Phase-4): narrow the grid to cards whose EXAMPLE sentences use a grammar point ----
let bGrammar = [];          // selected grammar ids (OR within the facet); empty = no constraint
let lastGrammarKey = null;  // signature of the present-id set, so chips rebuild only when it changes

// Render the grammar chips from the ids actually present across the deck's examples (ordered N5-first),
// reflecting the selection. Rebuilds the chip DOM only when the present set changes (a search keystroke
// won't churn it / steal focus); the whole row hides when no example carries grammar. Selections that
// vanish from the deck are pruned. Roving is handled by the boot-time .chips pass (a11y.js).
function renderGrammarChips() {
  const row = document.getElementById('bGrammarRow'), box = document.getElementById('bGrammarChips');
  const region = document.getElementById('bGrammarRegion');
  if (!row || !box) return;
  const present = new Set();
  for (const v of state.DATA) for (const g of cardGrammar(v)) present.add(g);
  if (bGrammar.length) bGrammar = bGrammar.filter((g) => present.has(g));
  const ids = orderGrammar(present);
  const show = ids.length > 0;                          // hide the toggle AND its disclosure region when no example carries grammar
  row.style.display = show ? '' : 'none';
  if (region) region.style.display = show ? '' : 'none';
  const key = ids.join(',');
  if (key === lastGrammarKey) {  // same chips → just re-sync active state, keep the DOM + focus
    box.querySelectorAll('.bg-gram').forEach((b) => {
      const on = bGrammar.includes(b.dataset.grammar);
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
    });
    return;
  }
  lastGrammarKey = key;
  box.innerHTML = ids.map((id) => {
    const on = bGrammar.includes(id);
    return `<button class="chip bg-gram${on ? ' active' : ''}" type="button" data-grammar="${escapeHtml(id)}" aria-pressed="${on}" title="${escapeHtml(grammarJlpt(id))} grammar">${escapeHtml(grammarLabel(id))}</button>`;
  }).join('');
}

// Re-render the whole grid on any filter/search change. passF = facet+rank filter; passQ =
// search text. The frequency "topN-M" tags are filtered OUT of the visible tag chips.
export function renderBrowse() {
  syncVerbRows('#panel-browse', bcfg, repaintBrowse);
  renderGrammarChips();   // (re)build the grammar facet from the deck's example tags (guarded)
  const q = document.getElementById('search').value.trim().toLowerCase();
  const grid = document.getElementById('grid'); grid.innerHTML = ''; let shown = 0;
  state.DATA.forEach(v => {
    const passF = passes(v, bcfg) && cardMatchesGrammar(v, bGrammar);
    const passQ = !q || v.read.includes(q) || v.jp.includes(q) || v.mean.toLowerCase().includes(q);
    if (!(passF && passQ)) return; shown++;
    const leech = isLeech(v.rank); const acc = rollingAcc(v.rank);
    const card = document.createElement('div');
    card.className = 'card ' + colorClass(v) + (leech ? ' leech' : '');  // class + leech recolor spine
    const tiLabel = v.trans === 't' ? 'transitive' : (v.trans === 'i' ? 'intransitive' : '');
    const stamp = cardStamp(v);
    // Cards are SUMMARY only — clicking opens the detail modal (openVerbDetail).
    card.innerHTML = `<div class="rank">#${v.rank}</div>
      ${acc != null ? `<div class="acc">${Math.round(acc * 100)}% acc</div>` : ''}
      <div class="card-top"><div>
        <div class="verb-jp jp">${v.jp}</div><div class="verb-reading">${pitchHtml(v.read, v.accent)}${TTS_OK ? ` ${speakBtnHtml({ cls: 'sm', label: 'Play reading' })}` : ''}</div>
        <div class="verb-meaning">${v.mean}</div></div>
        <div style="text-align:right"><div class="stamp ${stamp.cls}">${stamp.label}</div>
        <div class="jlpt-pill">${v.jlpt}</div>${provenanceBadge(v)}</div></div>
      ${leech ? '<span class="leech-badge">⚠ LEECH</span>' : ''}
      <div class="tags">${tiLabel ? `<span class="tag" style="color:var(--ichidan)">${tiLabel}</span>` : ''}${v.tags.filter(t => !t.startsWith('top') && t !== 'みんなの日本語' && !/^mnn-l\d+$/.test(t)).map(t => t === 'iTalki' ? `<span class="tag" style="color:var(--ichidan);border:1px solid var(--ichidan)">iTalki</span>` : `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>`;
    card.addEventListener('click', () => openVerbDetail(v));
    const sb = card.querySelector('.speak-btn');   // play reading without opening the modal
    if (sb) sb.addEventListener('click', e => { e.stopPropagation(); speakWord(v, 'browse', sb, { cycle: cycleMod(e) }); });
    grid.appendChild(card);
  });
  document.getElementById('num').textContent = shown;
  document.getElementById('numTotal').textContent = state.DATA.length;   // total browsable cards (built-ins + custom), not a hard-coded 100
  // Editorial header count pills (total deck + leeches); the leech pill hides at zero.
  const total = state.DATA.length, leechN = state.DATA.filter(v => isLeech(v.rank)).length;
  document.getElementById('bHeadCount').textContent = total;
  const lp = document.getElementById('bHeadLeechPill');
  if (lp) { lp.hidden = leechN === 0; document.getElementById('bHeadLeech').textContent = leechN; }
  document.getElementById('empty').style.display = shown ? 'none' : 'block';
  const parts = [...filterSummary(bcfg)];   // filterSummary returns an array of recap parts
  if (bGrammar.length) parts.push('grammar: ' + bGrammar.map(grammarLabel).join(', '));
  paintSummary('bSummary', parts);
}

// Wire the browse facets, range inputs, search, topic groups, and detail-modal controls.
export function initBrowseUI() {
  bcfg.rmax = state.MAXRANK;
  repaintBrowse = wireFacets('.chip.bf', bcfg, renderBrowse);
  makeMultiSelect('.chip.bjlpt', () => bcfg.jlpt, a => bcfg.jlpt = a, 'jlpt', renderBrowse);
  const brmin = document.getElementById('brmin'), brmax = document.getElementById('brmax');
  function bSyncRange() {
    let lo = parseInt(brmin.value) || 1, hi = parseInt(brmax.value) || state.MAXRANK;
    lo = Math.max(1, Math.min(state.MAXRANK, lo)); hi = Math.max(1, Math.min(state.MAXRANK, hi));
    if (lo > hi) { const t = lo; lo = hi; hi = t; }
    bcfg.rmin = lo; bcfg.rmax = hi; renderBrowse();
  }
  brmin.addEventListener('change', bSyncRange);
  brmax.addEventListener('change', bSyncRange);
  document.getElementById('search').addEventListener('input', renderBrowse);
  // Grammar facet: toggle a chip (OR within the facet) and re-render. Delegated on the stable
  // container so it survives the chip rebuilds renderGrammarChips does when the deck's set changes.
  document.getElementById('bGrammarChips').addEventListener('click', (e) => {
    const b = e.target.closest('.bg-gram'); if (!b) return;
    const id = b.dataset.grammar;
    bGrammar = bGrammar.includes(id) ? bGrammar.filter((g) => g !== id) : bGrammar.concat(id);
    renderBrowse();
  });
  setupTopicGroups();
  document.getElementById('detailClose').addEventListener('click', closeDetail);
  document.getElementById('detailModal').addEventListener('click', e => { if (e.target.id === 'detailModal') closeDetail(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('detailModal').classList.contains('show')) closeDetail(); });
}
