// 独り言 SELF-TALK tab — output/speaking practice. Narrate your day out loud: scene-grouped
// everyday phrases you read aloud, play through the unified audio player (per-context voice
// priority), record yourself, and A/B against a chosen REFERENCE voice (Siri/Google) via the
// shared record-and-compare engine. Unlike みんなの日本語 this is OFFLINE-FIRST + anonymous: the
// built-in starter phrases (data/selftalk.js) ship in the bundle and play/practice without an
// account. The user's own authored lines + a lightweight practice/streak signal live in
// state.selftalkStore (synced under the 'selftalk' app key); recording needs an account (takes
// are private/gated, like Minna's).
//
// Rendered lazily on tab activation (renderSelftalk), same pattern as Stats/Minna. Pure logic is
// core/selftalk.js, content is data/selftalk.js, and the record-and-compare engine is
// features/record-compare.js (Self-Talk feeds it a reserved numeric SCOPE + synth-only references).
import { state } from '../state.js';
import { localDay } from '../config.js';
import { escapeHtml, rubyHtml, plainText, groupByScene, grammarTokens, todaysSet, applyPractice, practiceStreak, donePhraseIds } from '../core/index.js';
import { SELFTALK, SELFTALK_SCENES, SELFTALK_GRAMMAR } from '../data/selftalk.js';
import { playItem, cycleMod } from './audio.js';
import { loadSelftalk, saveSelftalk } from '../persistence/selftalk.js';
import { account } from './cloud-core.js';
import {
  RECORD_SUPPORTED, enterSpeakingMode, exitSpeakingMode, isSpeakingMode,
  speakingBarHtml, initMicSelector, wireSpeakingControls,
  recordControlHtml, wireRecordCompare, paintCompareWaveforms, loadRecordings, setOnTakeSaved,
} from './record-compare.js';

const TODAY_N = 8;             // how many phrases land in the rotating "Today's focus"
// Reserved recordings partition for Self-Talk (the engine's `scope` → the server's opaque numeric
// `lesson` param). Minna uses lesson numbers 1–50; this sits far above them so they never collide.
const SELFTALK_SCOPE = 90000;

// View-only filter state (not synced).
let stGrammar = [];            // selected grammar tokens; empty = all
let stTodayOnly = false;       // narrow to today's rotating set
let recordingsLoaded = false;  // whether the take cache has been fetched this session

const elHead = () => document.getElementById('stHead');
const elBody = () => document.getElementById('stBody');
const $ = (id) => document.getElementById(id);

const grammarLabel = (id) => (SELFTALK_GRAMMAR.find((g) => g.id === id) || {}).label || id;
const sceneLabel = (id) => (SELFTALK_SCENES.find((s) => s.id === id) || {}).label || id;
const SCENE_IDS = SELFTALK_SCENES.map((s) => s.id);

// Built-in starter phrases + the user's own authored lines.
function allPhrases() {
  const custom = (state.selftalkStore && state.selftalkStore.phrases) || [];
  return SELFTALK.concat(custom);
}
// Phrases passing the current filters: grammar (ANY selected token), then optionally today's set.
function visiblePhrases() {
  let list = allPhrases();
  if (stGrammar.length) list = list.filter((p) => (p.grammar || []).some((g) => stGrammar.includes(g)));
  if (stTodayOnly) { const ids = new Set(todaysSet(list, localDay(), TODAY_N)); list = list.filter((p) => ids.has(p.id)); }
  return list;
}

// ---- render ----
export function renderSelftalk() {
  renderHead();
  renderBody();
  renderNavSpeaking();
}

function streakRowHtml() {
  const pr = (state.selftalkStore && state.selftalkStore.practice) || {};
  const today = localDay();
  const streak = practiceStreak(pr, today);
  const done = donePhraseIds(pr, today).size;
  if (streak > 0) {
    return `<div class="st-streak-row"><span class="st-streak"><svg class="ic" aria-hidden="true"><use href="#i-target"/></svg>${streak}-day streak</span>${done ? `<span class="st-today-count">${done} said today</span>` : ''}</div>`;
  }
  return `<div class="st-streak-row"><span class="st-streak-hint">Say a phrase out loud, then mark it — start a daily streak.</span></div>`;
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
      ${streakRowHtml()}
      <div class="st-actions"><button class="chip primary" type="button" data-stadd><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg>Add your own phrase</button></div>
    </div>
    <div class="frow"><span class="filter-label">Grammar</span>
      <div class="chips" role="group" aria-label="Grammar filter">${gramChip('all', 'All', allActive)}${chips}</div></div>
    <div class="frow"><span class="filter-label">Show</span>
      <div class="chips" role="group" aria-label="View">
        <button class="chip${stTodayOnly ? ' active' : ''}" type="button" data-sttoday aria-pressed="${stTodayOnly}">Today's focus</button>
      </div></div>`;
}

function doneSlotHtml(done) {
  return done
    ? `<span class="st-done"><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>said today</span>`
    : `<button class="st-mark" type="button" data-stdone>✓ I said it</button>`;
}

function phraseCardHtml(p, speaking, done) {
  const text = plainText(p.jp);
  const grams = (p.grammar || []).map((g) => `<span class="st-tag">${escapeHtml(grammarLabel(g))}</span>`).join('');
  const yours = p.custom ? '<span class="st-badge">yours</span>' : '';
  const edit = p.custom ? `<button class="st-edit" type="button" data-stedit aria-label="Edit phrase" title="Edit"><svg class="ic" aria-hidden="true"><use href="#i-edit"/></svg></button>` : '';
  // Record control (synth-only reference — no native clip): shown only in speaking mode + signed in.
  const rec = speaking && account ? recordControlHtml(SELFTALK_SCOPE, p.id, '', null, false, text, 'selftalk') : '';
  return `<div class="st-phrase${done ? ' practiced' : ''}" data-id="${escapeHtml(p.id)}">
    <button class="speak-btn st-play" type="button" data-play data-text="${escapeHtml(text)}" aria-label="Play phrase" title="Play — ⌥/⇧-click to try another voice"><svg class="ic" aria-hidden="true"><use href="#i-volume"/></svg></button>
    <div class="st-phrase-text">
      <div class="jp st-jp">${rubyHtml(p.jp)}</div>
      <div class="st-read">${escapeHtml(p.read || '')}</div>
      <div class="st-en">${escapeHtml(p.mean)}</div>
      <div class="st-phrase-meta">${yours}${grams}</div>
      <div class="st-bottom"><span class="st-done-slot">${doneSlotHtml(done)}</span>${rec}</div>
    </div>
    ${edit}
  </div>`;
}

function renderBody() {
  const body = elBody(); if (!body) return;
  const vis = visiblePhrases();
  if (!vis.length) { body.innerHTML = `<div class="st-empty">No phrases match this filter.</div>`; return; }
  const today = localDay();
  const doneSet = donePhraseIds(state.selftalkStore.practice, today);
  const speaking = isSpeakingMode();
  const groups = groupByScene(vis, SCENE_IDS);
  const section = (title, items, open) => items.length
    ? `<details class="st-section"${open ? ' open' : ''}><summary>${escapeHtml(title)} <span class="st-count">${items.length}</span></summary><div class="st-list">${items.map((p) => phraseCardHtml(p, speaking, doneSet.has(p.id))).join('')}</div></details>`
    : '';
  // Open the first scene (or everything when narrowed to today's focus); collapse the rest.
  body.innerHTML = groups.map((g, i) => section(sceneLabel(g.scene), g.items, i === 0 || stTodayOnly)).join('');
  wireRecordCompare(body);             // delegated record/play/delete/compare handlers (attach-once)
  if (speaking) paintCompareWaveforms(body);   // decode + draw take/reference waveforms
}

// ---- speaking bar (navbar #navExtra) — built from the engine primitives, like minna.js ----
function renderNavSpeaking() {
  const nav = document.getElementById('navExtra');
  if (!nav) return;
  // Recording is account-gated (takes are private/per-user) + capability-gated; otherwise no bar.
  if (!RECORD_SUPPORTED || !account) { nav.innerHTML = ''; return; }
  nav.innerHTML = speakingBarHtml();
  wireSpeakingControls(nav);   // speed chips + bias slider (attach-once on the slot; shared with Minna)
  const tog = nav.querySelector('[data-speaking-toggle]');
  if (tog) tog.addEventListener('click', async () => {
    if (isSpeakingMode()) { exitSpeakingMode(); renderSelftalk(); return; }
    if (!(await enterSpeakingMode())) return;
    if (!recordingsLoaded) { await loadRecordings(SELFTALK_SCOPE); recordingsLoaded = true; }
    renderSelftalk();          // re-render so the per-phrase record controls + bar appear
  });
  initMicSelector(nav, () => { if (isSpeakingMode()) enterSpeakingMode(); });
}
function clearNavSpeaking() { const nav = document.getElementById('navExtra'); if (nav) nav.innerHTML = ''; }

// ---- practice signal (streak + "said today") ----
function markPracticed(id) {
  state.selftalkStore.practice = applyPractice(state.selftalkStore.practice, id, localDay());
  saveSelftalk();
}
// Light in-place UI update after a practice mark — refresh the streak chip + flip the one card's
// ✓, WITHOUT a body re-render (which would tear down an in-flight record control / compare).
function reflectPracticed(id) {
  renderHead();
  const card = [...document.querySelectorAll('.st-phrase')].find((c) => c.dataset.id === id);
  if (card) {
    card.classList.add('practiced');
    const slot = card.querySelector('.st-done-slot');
    if (slot) slot.innerHTML = doneSlotHtml(true);
  }
}

// ---- grammar / view filters ----
function toggleGrammar(tok) {
  if (tok === 'all') stGrammar = [];
  else if (stGrammar.includes(tok)) stGrammar = stGrammar.filter((t) => t !== tok);
  else stGrammar = stGrammar.concat(tok);
  renderSelftalk();
}

// ---- authoring (your own phrases) ----
let editingId = null;

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
// Auto-exit when navigating away from the tab (chrome.js leaveSelftalk → main.js), so the mic
// never lingers. Mirrors minna.js onMinnaHidden.
export function onSelftalkHidden() { exitSpeakingMode(); clearNavSpeaking(); }

// Release the mic when the BROWSER tab is hidden while speaking — but only if Self-Talk is the
// active panel (don't fight Minna's own visibilitychange handler; exitSpeakingMode is idempotent).
function handleBrowserTabHidden() {
  if (!document.hidden || !isSpeakingMode()) return;
  const panel = document.getElementById('panel-selftalk');
  if (!panel || !panel.classList.contains('active')) return;
  exitSpeakingMode();
  renderSelftalk();   // repaint the toggle/controls to the released state
}

export function initSelftalk() {
  loadSelftalk();
  // Record a practice mark when a Self-Talk take is saved (engine host hook; ignores Minna takes).
  setOnTakeSaved((scope, itemKey) => { if (scope === SELFTALK_SCOPE) { markPracticed(itemKey); reflectPracticed(itemKey); } });
  document.addEventListener('visibilitychange', handleBrowserTabHidden);

  const panel = document.getElementById('panel-selftalk');
  if (panel && !panel.dataset.stWired) {
    panel.dataset.stWired = '1';
    panel.addEventListener('click', (e) => {
      const play = e.target.closest('[data-play]');
      if (play) { playItem({ text: play.dataset.text || '' }, 'selftalk', play, { cycle: cycleMod(e) }); return; }
      const mark = e.target.closest('[data-stdone]');
      if (mark) { const card = mark.closest('.st-phrase'); if (card) { markPracticed(card.dataset.id); reflectPracticed(card.dataset.id); } return; }
      const ed = e.target.closest('[data-stedit]');
      if (ed) { const card = ed.closest('.st-phrase'); if (card) openPhraseModal(card.dataset.id); return; }
      const add = e.target.closest('[data-stadd]');
      if (add) { openPhraseModal(null); return; }
      const gram = e.target.closest('[data-stgram]');
      if (gram) { toggleGrammar(gram.dataset.stgram); return; }
      const today = e.target.closest('[data-sttoday]');
      if (today) { stTodayOnly = !stTodayOnly; renderSelftalk(); return; }
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
