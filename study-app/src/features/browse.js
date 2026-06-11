// BROWSE — the reference grid. Independent filter state (bcfg) from the study deck, but
// evaluated by the same passes() predicate, plus a free-text search over reading/kanji/
// meaning. Clicking a card opens the detail MODAL (openVerbDetail), not an inline expand.
import { state } from '../state.js';
import {
  passes, isLeech, rollingAcc, colorClass, cardStamp, pitchHtml, escapeHtml,
  availableTiers, exampleForLevel, JLPT_TIERS, BOX_COLORS, nextDueLabel, filterSummary,
} from '../core/index.js';
import { settings } from '../settings-store.js';
import { speakWord, TTS_OK } from './tts.js';
import { jishoUrl, provenanceBadge } from './render-helpers.js';
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

/* Collapsible Topic groups. The chips inside stay wired by their .bf/.deck class + data-*
   (makeMultiSelect ignores DOM nesting); this only toggles a max-height region and keeps a
   live "· N" badge on the toggle. A MutationObserver on the region's class attrs keeps the
   badge correct even when selections change programmatically. Open state persists per-panel. */
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
    new MutationObserver(refresh).observe(region, { subtree: true, attributes: true, attributeFilter: ['class'] });
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
  const ex = exampleForLevel(v, lvl), jp = document.getElementById('dExJp'), en = document.getElementById('dExEn');
  if (ex) { jp.innerHTML = ex[0]; en.textContent = ex[1]; } else { jp.textContent = 'No example yet.'; en.textContent = ''; }
}
export function openVerbDetail(v) {
  detailVerb = v; detailLevel = null;
  const tiLabel = v.trans === 't' ? 'transitive' : (v.trans === 'i' ? 'intransitive' : '');
  const tags = `${tiLabel ? `<span class="tag" style="color:var(--ichidan)">${tiLabel}</span>` : ''}${v.tags.filter(t => !t.startsWith('top')).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}`;
  document.getElementById('detailBody').innerHTML = `
    <div class="card-top"><div>
      <div class="verb-jp jp" style="font-size:34px">${v.jp}</div>
      <div class="verb-reading">${pitchHtml(v.read, v.accent)}${TTS_OK ? ` <button class="speak-btn sm" id="dSpeak" type="button" aria-label="Play reading" title="Play reading"><svg class="ic" aria-hidden="true"><use href="#i-volume"/></svg></button>` : ''}</div>
      <div class="verb-meaning">${v.mean}</div>
      <a class="jisho-link" target="_blank" rel="noopener noreferrer" href="${jishoUrl(v.jp)}"><svg class="ic" aria-hidden="true"><use href="#i-external"/></svg>View on Jisho</a></div>
      <div style="text-align:right"><div class="stamp ${cardStamp(v).cls}">${cardStamp(v).label}</div><div class="jlpt-pill">${v.jlpt}</div>${provenanceBadge(v)}</div></div>
    ${isLeech(v.rank) ? '<span class="leech-badge">⚠ LEECH</span>' : ''}
    <div class="tags">${tags}</div>
    ${detailMemoryLine(v)}
    ${v.mnem ? `<details open><summary>Mnemonic</summary><div class="det-body">${v.mnem}</div></details>` : ''}
    ${v.tip ? `<details><summary>Trap / tip</summary><div class="det-body">${v.tip}</div></details>` : ''}
    <details><summary>Example sentences</summary><div class="det-body">
      <span class="jlptseg exseg" id="dExLevels" role="group" aria-label="Example level"></span>
      <div class="ex-jp jp" id="dExJp" style="margin-top:8px"></div><div class="ex-en" id="dExEn"></div>
    </div></details>
    ${v.custom ? `<div class="verb-actions"><button class="chip" id="dEdit" type="button"><svg class="ic" aria-hidden="true"><use href="#i-edit"/></svg>Edit</button><button class="chip" id="dDel" type="button" style="border-color:var(--godan);color:var(--godan)"><svg class="ic" aria-hidden="true"><use href="#i-trash"/></svg>Delete</button></div>` : ''}`;
  renderDetailExample();
  const sp = document.getElementById('dSpeak'); if (sp) sp.addEventListener('click', () => speakWord(v));
  const seg = document.getElementById('dExLevels'); if (seg) seg.addEventListener('click', e => { const b = e.target.closest('.exlv'); if (!b || b.disabled) return; detailLevel = b.dataset.exlv; renderDetailExample(); });
  if (v.custom) {
    const eb = document.getElementById('dEdit'), db = document.getElementById('dDel');
    if (eb) eb.addEventListener('click', () => { closeDetail(); openVerbModal(v); });
    if (db) db.addEventListener('click', () => { if (confirm('Delete custom card ' + v.jp + '? Its progress is also removed.')) { closeDetail(); deleteVerb(v.rank); } });
  }
  document.getElementById('detailModal').classList.add('show');
}
function closeDetail() { document.getElementById('detailModal').classList.remove('show'); }

// Re-render the whole grid on any filter/search change. passF = facet+rank filter; passQ =
// search text. The frequency "topN-M" tags are filtered OUT of the visible tag chips.
export function renderBrowse() {
  syncVerbRows('#panel-browse', bcfg, repaintBrowse);
  const q = document.getElementById('search').value.trim().toLowerCase();
  const grid = document.getElementById('grid'); grid.innerHTML = ''; let shown = 0;
  state.DATA.forEach(v => {
    const passF = passes(v, bcfg);
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
        <div class="verb-jp jp">${v.jp}</div><div class="verb-reading">${pitchHtml(v.read, v.accent)}${TTS_OK ? ` <button class="speak-btn sm" type="button" aria-label="Play reading" title="Play reading"><svg class="ic" aria-hidden="true"><use href="#i-volume"/></svg></button>` : ''}</div>
        <div class="verb-meaning">${v.mean}</div></div>
        <div style="text-align:right"><div class="stamp ${stamp.cls}">${stamp.label}</div>
        <div class="jlpt-pill">${v.jlpt}</div>${provenanceBadge(v)}</div></div>
      ${leech ? '<span class="leech-badge">⚠ LEECH</span>' : ''}
      <div class="tags">${tiLabel ? `<span class="tag" style="color:var(--ichidan)">${tiLabel}</span>` : ''}${v.tags.filter(t => !t.startsWith('top') && t !== 'みんなの日本語' && !/^mnn-l\d+$/.test(t)).map(t => t === 'iTalki' ? `<span class="tag" style="color:var(--ichidan);border:1px solid var(--ichidan)">iTalki</span>` : `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>`;
    card.addEventListener('click', () => openVerbDetail(v));
    const sb = card.querySelector('.speak-btn');   // play reading without opening the modal
    if (sb) sb.addEventListener('click', e => { e.stopPropagation(); speakWord(v); });
    grid.appendChild(card);
  });
  document.getElementById('num').textContent = shown;     // "Showing N of 100"
  document.getElementById('empty').style.display = shown ? 'none' : 'block';
  paintSummary('bSummary', filterSummary(bcfg));
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
  setupTopicGroups();
  document.getElementById('detailClose').addEventListener('click', closeDetail);
  document.getElementById('detailModal').addEventListener('click', e => { if (e.target.id === 'detailModal') closeDetail(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('detailModal').classList.contains('show')) closeDetail(); });
}
