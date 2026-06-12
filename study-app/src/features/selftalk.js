// 独り言 SELF-TALK tab — output/speaking practice. Narrate your day out loud: scene-grouped
// everyday phrases you read aloud, play through the unified audio player (per-context voice
// priority), and — in the record-and-compare commit — record yourself and A/B against a chosen
// reference voice. Unlike みんなの日本語 this is OFFLINE-FIRST + anonymous: the built-in starter
// phrases (data/selftalk.js) ship in the bundle. The user's own authored lines + a lightweight
// practice/streak signal live in state.selftalkStore (synced under the 'selftalk' app key).
//
// Rendered lazily on tab activation (renderSelftalk), same pattern as Stats/Minna. This module is
// the Self-Talk glue; pure logic is core/selftalk.js, content is data/selftalk.js, and the
// record-and-compare engine (reused next commit) is features/record-compare.js.
import { state } from '../state.js';
import { localDay } from '../config.js';
import { escapeHtml, rubyHtml, plainText, groupByScene, grammarTokens, todaysSet } from '../core/index.js';
import { SELFTALK, SELFTALK_SCENES, SELFTALK_GRAMMAR } from '../data/selftalk.js';
import { playItem, cycleMod } from './audio.js';
import { loadSelftalk, saveSelftalk } from '../persistence/selftalk.js';

const TODAY_N = 8;   // how many phrases land in the rotating "Today's set"

// View-only filter state (not synced): selected grammar tokens; empty = all.
let stGrammar = [];

const elHead = () => document.getElementById('stHead');
const elBody = () => document.getElementById('stBody');

const grammarLabel = (id) => (SELFTALK_GRAMMAR.find((g) => g.id === id) || {}).label || id;
const sceneLabel = (id) => (SELFTALK_SCENES.find((s) => s.id === id) || {}).label || id;

// Built-in starter phrases + the user's own authored lines (state.selftalkStore.phrases).
function allPhrases() {
  const custom = (state.selftalkStore && state.selftalkStore.phrases) || [];
  return SELFTALK.concat(custom);
}
// The phrases passing the current grammar filter (a phrase matches if it carries ANY selected
// token; no selection = all).
function visiblePhrases() {
  const all = allPhrases();
  if (!stGrammar.length) return all;
  return all.filter((p) => (p.grammar || []).some((g) => stGrammar.includes(g)));
}

// ---- render ----
export function renderSelftalk() {
  renderHead();
  renderBody();
}

function renderHead() {
  const head = elHead(); if (!head) return;
  const toks = grammarTokens(allPhrases(), SELFTALK_GRAMMAR.map((g) => g.id));
  const allActive = !stGrammar.length;
  const gramChip = (tok, label, on) =>
    `<button class="chip st-gram${on ? ' active' : ''}" type="button" data-stgram="${escapeHtml(tok)}" aria-pressed="${on}">${escapeHtml(label)}</button>`;
  const chips = toks.map((t) => gramChip(t, grammarLabel(t), stGrammar.includes(t))).join('');
  head.innerHTML = `
    <div class="st-intro">
      <p class="st-kicker">独り言 · Self-Talk</p>
      <p class="st-lede">Narrate your day out loud. Tap ▶ to hear a phrase, then say it yourself — ⌥/⇧-click ▶ to try another voice.</p>
      <div class="st-actions"><button class="chip primary" type="button" data-stadd><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg>Add your own phrase</button></div>
    </div>
    <div class="frow"><span class="filter-label">Grammar</span>
      <div class="chips" role="group" aria-label="Grammar filter">
        ${gramChip('all', 'All', allActive)}${chips}
      </div></div>`;
}

function phraseCardHtml(p) {
  const text = plainText(p.jp);
  const grams = (p.grammar || []).map((g) => `<span class="st-tag">${escapeHtml(grammarLabel(g))}</span>`).join('');
  const yours = p.custom ? '<span class="st-badge">yours</span>' : '';
  const edit = p.custom ? `<button class="st-edit" type="button" data-stedit aria-label="Edit phrase" title="Edit"><svg class="ic" aria-hidden="true"><use href="#i-edit"/></svg></button>` : '';
  return `<div class="st-phrase" data-id="${escapeHtml(p.id)}">
    <button class="speak-btn st-play" type="button" data-play data-text="${escapeHtml(text)}" aria-label="Play phrase" title="Play — ⌥/⇧-click to try another voice"><svg class="ic" aria-hidden="true"><use href="#i-volume"/></svg></button>
    <div class="st-phrase-text">
      <div class="jp st-jp">${rubyHtml(p.jp)}</div>
      <div class="st-read">${escapeHtml(p.read || '')}</div>
      <div class="st-en">${escapeHtml(p.mean)}</div>
      <div class="st-phrase-meta">${yours}${grams}</div>
    </div>
    ${edit}
  </div>`;
}

function sectionHtml(title, items, open) {
  if (!items.length) return '';
  return `<details class="st-section"${open ? ' open' : ''}>
    <summary>${escapeHtml(title)} <span class="st-count">${items.length}</span></summary>
    <div class="st-list">${items.map(phraseCardHtml).join('')}</div>
  </details>`;
}

function renderBody() {
  const body = elBody(); if (!body) return;
  const vis = visiblePhrases();
  if (!vis.length) { body.innerHTML = `<div class="st-empty">No phrases match this grammar filter.</div>`; return; }
  const todayIds = new Set(todaysSet(vis, localDay(), TODAY_N));
  const todayItems = vis.filter((p) => todayIds.has(p.id));
  const groups = groupByScene(vis, SELFTALK_SCENES.map((s) => s.id));
  let html = sectionHtml("Today's set", todayItems, true);
  html += groups.map((g) => sectionHtml(sceneLabel(g.scene), g.items, false)).join('');
  body.innerHTML = html;
}

// ---- grammar filter ----
function toggleGrammar(tok) {
  if (tok === 'all') stGrammar = [];
  else if (stGrammar.includes(tok)) stGrammar = stGrammar.filter((t) => t !== tok);
  else stGrammar = stGrammar.concat(tok);
  renderSelftalk();
}

// ---- authoring (your own phrases) ----
// The user's lines live in state.selftalkStore.phrases (synced under the 'selftalk' key). Only
// these custom phrases are editable/deletable; built-ins are read-only. The modal lives in
// index.html (#stPhraseModal); scene + grammar options are populated at open so they can't drift.
let editingId = null;
const $ = (id) => document.getElementById(id);

function openPhraseModal(id) {
  editingId = id || null;
  const existing = id ? (state.selftalkStore.phrases || []).find((p) => p.id === id) : null;
  $('stPhScene').innerHTML = SELFTALK_SCENES.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.label)}</option>`).join('');
  const sel = new Set(existing ? (existing.grammar || []) : []);
  $('stPhGram').innerHTML = SELFTALK_GRAMMAR.map((g) =>
    `<label class="st-gram-check"><input type="checkbox" value="${escapeHtml(g.id)}"${sel.has(g.id) ? ' checked' : ''}> ${escapeHtml(g.label)}</label>`).join('');
  $('stPhJp').value = existing ? existing.jp : '';
  $('stPhRead').value = existing ? (existing.read || '') : '';
  $('stPhMean').value = existing ? existing.mean : '';
  if (existing) $('stPhScene').value = existing.scene;
  $('stPhTitle').textContent = existing ? 'Edit phrase' : 'Add a phrase';
  $('stPhSubmit').textContent = existing ? 'Save changes' : 'Save phrase';
  $('stPhDelete').hidden = !existing;
  $('stPhErr').textContent = '';
  $('stPhraseModal').classList.add('show');
  $('stPhJp').focus();
}
function closePhraseModal() { $('stPhraseModal').classList.remove('show'); editingId = null; }

function newPhraseId() {
  return 'usr-' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.floor(performance.now()).toString(36));
}

function savePhrase(e) {
  e.preventDefault();
  const jp = $('stPhJp').value.trim(), mean = $('stPhMean').value.trim();
  if (!jp || !mean) { $('stPhErr').textContent = 'Japanese and English are required.'; return; }
  const phrase = {
    id: editingId || newPhraseId(),
    jp, mean,
    read: $('stPhRead').value.trim(),
    scene: $('stPhScene').value || SELFTALK_SCENES[0].id,
    grammar: [...document.querySelectorAll('#stPhGram input:checked')].map((c) => c.value),
    custom: true,
  };
  const phrases = state.selftalkStore.phrases = state.selftalkStore.phrases || [];
  const i = phrases.findIndex((p) => p.id === phrase.id);
  if (i >= 0) phrases[i] = phrase; else phrases.push(phrase);
  saveSelftalk();
  closePhraseModal();
  renderSelftalk();
}
function deletePhrase() {
  if (!editingId) return;
  state.selftalkStore.phrases = (state.selftalkStore.phrases || []).filter((p) => p.id !== editingId);
  saveSelftalk();
  closePhraseModal();
  renderSelftalk();
}

// ---- lifecycle ----
// Auto-exit hook fired when navigating away from the tab. The mic/speaking-mode teardown is wired
// in the record-and-compare commit; today there's nothing holding a stream, so it's a no-op.
export function onSelftalkHidden() {}

// Wire the panel once (delegated, since #stHead/#stBody re-render): play buttons + grammar chips.
// Reads all context off data-* so it survives the innerHTML swaps.
export function initSelftalk() {
  loadSelftalk();
  const panel = document.getElementById('panel-selftalk');
  if (panel && !panel.dataset.stWired) {
    panel.dataset.stWired = '1';
    panel.addEventListener('click', (e) => {
      const play = e.target.closest('[data-play]');
      if (play) { playItem({ text: play.dataset.text || '' }, 'selftalk', play, { cycle: cycleMod(e) }); return; }
      const ed = e.target.closest('[data-stedit]');
      if (ed) { const card = ed.closest('.st-phrase'); if (card) openPhraseModal(card.dataset.id); return; }
      const add = e.target.closest('[data-stadd]');
      if (add) { openPhraseModal(null); return; }
      const gram = e.target.closest('[data-stgram]');
      if (gram) { toggleGrammar(gram.dataset.stgram); return; }
    });
  }
  // Authoring modal (#stPhraseModal): close / backdrop / Escape / submit / delete — wired once.
  const modal = document.getElementById('stPhraseModal');
  if (modal && !modal.dataset.stWired) {
    modal.dataset.stWired = '1';
    document.getElementById('stPhClose').addEventListener('click', closePhraseModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closePhraseModal(); });
    document.getElementById('stPhForm').addEventListener('submit', savePhrase);
    document.getElementById('stPhDelete').addEventListener('click', deletePhrase);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('show')) closePhraseModal(); });
  }
}
