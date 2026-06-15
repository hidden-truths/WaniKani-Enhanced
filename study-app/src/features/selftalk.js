// 独り言 SELF-TALK tab — output/speaking practice. Narrate your day out loud. #stBody is a two-level
// browse: a category→topic GRID (renderGrid) whose cells drill into a single topic's phrase list
// (renderTopic) — clicking a cell swaps #stBody in place, keeping it the stable attach-once
// record-compare container; a pinned "Today's focus" cell drills into the rotating daily set. In a
// topic you read each phrase aloud, play it through the unified audio player (per-context voice
// priority), record yourself, and A/B against a chosen REFERENCE voice (Siri/Google) via the
// shared record-and-compare engine. Unlike みんなの日本語 this is ANON-READABLE: the built-in
// starter phrases are public rows in the server sentence store (fetched via
// GET /v1/sentences?ownerType=selftalk, with a localStorage read-through cache — see below), so
// anyone can read/play/practice them without an account; they are NOT shipped in the bundle. The
// user's own authored lines + a lightweight practice/streak signal live in state.selftalkStore
// (synced under the 'selftalk' app key); authoring AND recording need an account (takes are
// private/gated, like Minna's).
//
// Rendered lazily on tab activation (renderSelftalk), same pattern as Stats/Minna. Pure logic is
// core/selftalk.js, the content seed is data/selftalk.js, and the record-and-compare engine is
// features/record-compare.js (Self-Talk feeds it a reserved numeric SCOPE + synth-only references).
import { state } from '../state.js';
import { localDay } from '../config.js';
import { escapeHtml, rubyHtml, plainText, overlayTokens, topicGrid, groupByThought, grammarTokens, todaysSet, applyPractice, practiceStreak, donePhraseIds, sentenceToPhrase, phraseToSentence, realizeTemplate, cyclePick, templatePickIndex } from '../core/index.js';
import { SELFTALK_TAXONOMY, SELFTALK_TOPICS, SELFTALK_GRAMMAR } from '../data/selftalk.js';
import { playItem, cycleMod } from './audio.js';
import { wireWordTaps } from './word-lookup.js';
import { loadSelftalk, saveSelftalk } from '../persistence/selftalk.js';
import { account, api, setSyncStatus } from './cloud-core.js';
import {
  RECORD_SUPPORTED, enterSpeakingMode, exitSpeakingMode, isSpeakingMode,
  speakingBarHtml, initMicSelector, wireSpeakingControls,
  recordControlHtml, wireRecordCompare, paintCompareWaveforms, loadRecordings, setOnTakeSaved,
} from './record-compare.js';

const TODAY_N = 8;             // how many phrases land in the rotating "Today's focus"
// Reserved recordings partition for Self-Talk (the engine's `scope` → the server's opaque numeric
// `lesson` param). Minna uses lesson numbers 1–50; this sits far above them so they never collide.
const SELFTALK_SCOPE = 90000;

// View-only state (not synced). stTopic drives the drill-in: null = the grid; a topic id = that
// topic's phrase list; TODAY_TOPIC = the rotating daily set. The grammar filter is cross-cutting
// (applies in both views). Only ONE view renders at a time, so a phrase's record control never
// double-renders for the same (scope,itemKey) — the "Today's focus is a filter, not a duplicate
// section" invariant, preserved by drilling rather than stacking.
const TODAY_TOPIC = '__today__';
const REGISTER_LABELS = { plain: 'plain form', polite: 'です・ます', intimate: 'casual / intimate' };
const registerLabel = (r) => REGISTER_LABELS[r] || r;
let stGrammar = [];            // selected grammar tokens; empty = all
let stTopic = null;            // null = grid; topic id / TODAY_TOPIC = drilled-in topic view
const tplPicks = {};           // templateId → { slotId: fillerIndex } (current slot-swap selection)
let lpFired = false;           // a long-press just opened a slot menu → suppress the ensuing cycle-click
let recordingsLoaded = false;  // whether the take cache has been fetched this session

// Phrases now come from the unified sentence store (GET /v1/sentences?ownerType=selftalk):
// built-in public rows for everyone, plus the signed-in user's own private rows. We keep the
// last good fetch in localStorage as a READ-THROUGH cache so the tab still renders if the
// fetch fails (offline / server down). The bundled SELFTALK constant in data/selftalk.js is no
// longer read at runtime — it's the seed source for scripts/seed-sentences.ts.
const STORE_CACHE_KEY = 'jpverbs_selftalk_cache';
let storePhrases = [];         // the live phrase set (built-ins + own), from the fetch or the cache

function loadCachedPhrases() {
  try { const o = JSON.parse(localStorage.getItem(STORE_CACHE_KEY)); if (Array.isArray(o)) return o; } catch (e) {}
  return [];
}
function cachePhrases(phrases) {
  try { localStorage.setItem(STORE_CACHE_KEY, JSON.stringify(phrases)); } catch (e) {}
}

// Refresh storePhrases from the store + update the cache. Degrades to the cache on failure so
// the tab never goes blank from a network hiccup. Returns true on a successful network refresh.
export async function refreshPhrases() {
  try {
    const r = await api('/v1/sentences?ownerType=selftalk&annotate=1');
    storePhrases = ((r && r.sentences) || []).map(sentenceToPhrase);
    cachePhrases(storePhrases);
    return true;
  } catch (e) {
    if (!storePhrases.length) storePhrases = loadCachedPhrases();   // offline first load → fall back to cache
    return false;
  }
}

// Optimistic local-set mutators: authoring updates storePhrases + the cache immediately so the UI
// reflects the change before the API write confirms (the usr-<uuid> id is final from birth, so
// there's no temp-id reconciliation).
function upsertLocalPhrase(phrase) {
  const i = storePhrases.findIndex((p) => p.id === phrase.id);
  if (i >= 0) storePhrases[i] = phrase; else storePhrases.push(phrase);
  cachePhrases(storePhrases);
}
function removeLocalPhrase(id) {
  storePhrases = storePhrases.filter((p) => p.id !== id);
  cachePhrases(storePhrases);
}

// Slot-swap TEMPLATES now come from the store too (GET /v1/templates), not the JS bundle — same
// read-through-cache pattern as phrases (degrade to cache offline). The bundled SELFTALK_TEMPLATES
// (data/selftalk-templates.js) is the seed source for scripts/seed-sentences.ts, no longer imported
// at runtime. The realize/render code is unchanged — it operates on this same
// { id, topic, thought?, grammar, en, jp, slots } structure, and `id` stays the SKELETON ext_id the
// record-compare keys on.
const TPL_CACHE_KEY = 'jpverbs_selftalk_templates_cache';
let storeTemplates = [];       // the live template set, from the fetch or the cache

function loadCachedTemplates() {
  try { const o = JSON.parse(localStorage.getItem(TPL_CACHE_KEY)); if (Array.isArray(o)) return o; } catch (e) {}
  return [];
}
function cacheTemplates(t) {
  try { localStorage.setItem(TPL_CACHE_KEY, JSON.stringify(t)); } catch (e) {}
}

// Refresh storeTemplates from the store + update the cache. Degrades to the cache on failure so the
// slot-swap cards never vanish from a network hiccup. Returns true on a successful network refresh.
export async function refreshTemplates() {
  try {
    const r = await api('/v1/templates?source=selftalk');
    storeTemplates = (r && r.templates) || [];
    cacheTemplates(storeTemplates);
    return true;
  } catch (e) {
    if (!storeTemplates.length) storeTemplates = loadCachedTemplates();   // offline first load → fall back to cache
    return false;
  }
}

// Templates for one topic id (the curated set is small, so a linear scan is fine). Replaces the
// import-time helper of the same name from the bundle.
function templatesForTopic(topicId) {
  return storeTemplates.filter((t) => t.topic === topicId);
}

// ---- lazy materialization of template combos (Slice 2) ----
// First time a signed-in user PLAYS or RECORDS a template combo, materialize it as a public
// `sentence` row server-side so the store tooling (NLP tap-to-lookup, TTS pre-gen, grammar search,
// export, de-dup) covers the combos people actually use. We send ONLY the picks — the server
// reconstructs the realized text/furigana/English from the stored skeleton (it's authoritative; the
// client can't materialize a row whose text doesn't match the curated template). Fire-and-forget,
// account-gated (it writes the PUBLIC corpus; anon just keeps playing via the lazy TTS path).
// Record-compare still keys on the SKELETON id — this never touches practice/takes. Deduped per
// session by the canonical combo key so cycling/replaying a combo POSTs at most once.
const materializedCombos = new Set();

// The canonical combo key over ALL of a template's slots (skeleton order, each clamped index) — the
// SAME string the server derives for the sentence_link role, so our dedup matches its idempotency.
function comboKey(tpl, picks) {
  return (tpl.slots || []).map((s) => `${s.id}:${templatePickIndex(s, picks)}`).join(',');
}

function maybeMaterialize(id) {
  if (!account) return;                                   // public-corpus write → signed-in only
  const tpl = storeTemplates.find((t) => t.id === id);
  if (!tpl) return;                                       // a phrase, not a template — nothing to do
  const key = id + '|' + comboKey(tpl, tplPicks[id] || {});
  if (materializedCombos.has(key)) return;               // already sent this combo this session
  materializedCombos.add(key);
  api('/v1/templates/' + encodeURIComponent(id) + '/realize', { method: 'POST', body: { picks: tplPicks[id] || {} } })
    .catch(() => materializedCombos.delete(key));         // failed write → let it retry next time
}

const elHead = () => document.getElementById('stHead');
const elBody = () => document.getElementById('stBody');
const $ = (id) => document.getElementById(id);

const grammarLabel = (id) => (SELFTALK_GRAMMAR.find((g) => g.id === id) || {}).label || id;

// The phrase set to render: the store fetch/cache (built-ins + the user's own private rows).
// Until the legacy migration runs (on sign-in), any phrases still in the local `selftalk` blob
// are concatenated so a user's existing authored lines don't vanish — de-duped by id (the store
// wins), so a migrated phrase that appears in both is shown once.
function allPhrases() {
  const legacy = (state.selftalkStore && state.selftalkStore.phrases) || [];
  if (!legacy.length) return storePhrases;
  const have = new Set(storePhrases.map((p) => p.id));
  return storePhrases.concat(legacy.filter((p) => !have.has(p.id)));
}
// The phrase set after the cross-cutting grammar filter (ANY selected token; empty = all). Both the
// grid and the drilled-in topic view start here; the today/topic narrowing happens per-view.
function filteredPhrases() {
  const list = allPhrases();
  return stGrammar.length ? list.filter((p) => (p.grammar || []).some((g) => stGrammar.includes(g))) : list;
}
// The slot-swap templates passing the grammar filter (each carries `topic`/`thought`/`id`, so they
// count + group exactly like phrases). Used both for the grid tally and the drilled-in topic merge.
function filteredTemplates() {
  return stGrammar.length ? storeTemplates.filter((t) => (t.grammar || []).some((g) => stGrammar.includes(g))) : storeTemplates;
}

// ---- render ----
export function renderSelftalk() {
  renderHead();
  renderBody();
  renderNavSpeaking();
}

// Tab-activation entry: paint from what we have (cache / last fetch) for an instant frame, refresh
// from the store, then repaint if the network set changed. Wired in main.js as the 独り言 tab's
// render handler (renderSelftalk stays the render-only fn used by the internal re-renders).
export async function showSelftalk() {
  if (!storeTemplates.length) storeTemplates = loadCachedTemplates();   // instant frame from cache (templates)
  const hadCache = storePhrases.length > 0;
  if (hadCache) renderSelftalk();
  const [phrasesChanged, templatesChanged] = await Promise.all([refreshPhrases(), refreshTemplates()]);
  if (phrasesChanged || templatesChanged || !hadCache) renderSelftalk();
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

// Authoring now writes PRIVATE server rows, so it requires an account; anon gets a sign-in nudge
// (reading stays anon). Mirrors how the record controls gate on `account`.
function addAffordanceHtml() {
  return account
    ? `<button class="chip primary" type="button" data-stadd><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg>Add your own phrase</button>`
    : `<button class="chip" type="button" data-stsignin><svg class="ic" aria-hidden="true"><use href="#i-user"/></svg>Sign in to add your own phrases</button>`;
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
      <div class="st-actions">${addAffordanceHtml()}</div>
    </div>
    <div class="frow"><span class="filter-label">Grammar</span>
      <div class="chips" role="group" aria-label="Grammar filter">${gramChip('all', 'All', allActive)}${chips}</div></div>`;
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
      <div class="jp st-jp">${p.tokens && p.furigana ? overlayTokens(p.furigana, p.tokens) : rubyHtml(p.jp)}</div>
      <div class="st-read">${escapeHtml(p.read || '')}</div>
      <div class="st-en">${escapeHtml(p.mean)}</div>
      <div class="st-phrase-meta">${yours}${grams}</div>
      <div class="st-bottom"><span class="st-done-slot">${doneSlotHtml(done)}</span>${rec}</div>
    </div>
    ${edit}
  </div>`;
}

// ---- slot-swap template cards (P3) ----
// The realized sentence: each {slot} is a swappable chip (current filler in ruby) + a hidden filler
// menu (⌥-click / long-press opens it); fixed parts render as plain ruby (no tap-to-lookup over the
// unbounded combo space). Reuses rubyHtml so the global furigana flip applies.
function templateSentenceHtml(tpl, picks) {
  return String(tpl.jp || '').split(/(\{\w+\})/).map((part) => {
    const m = part.match(/^\{(\w+)\}$/);
    if (!m) return rubyHtml(part);
    const slot = (tpl.slots || []).find((s) => s.id === m[1]);
    if (!slot) return '';
    const idx = templatePickIndex(slot, picks);
    const fillers = slot.fillers || [];
    const menu = fillers.map((f, i) =>
      `<button class="st-fill${i === idx ? ' active' : ''}" type="button" data-st-pick="${escapeHtml(slot.id)}" data-fill="${i}">${rubyHtml(f.jp || '')}<span class="st-fill-en">${escapeHtml(f.en || '')}</span></button>`).join('');
    return `<span class="st-slot-wrap"><button class="st-slot" type="button" data-st-slot="${escapeHtml(slot.id)}" aria-label="Swap ${escapeHtml(slot.label || slot.id)}" title="Tap to swap · ⌥-click or long-press for all options">${rubyHtml((fillers[idx] || {}).jp || '')}</button><span class="st-slot-menu" hidden>${menu}</span></span>`;
  }).join('');
}

// A template renders the SAME card chrome as a phrase (.st-phrase → done/streak + record controls
// just work via data-id), plus a "template" badge + a shuffle button. The record control keys on the
// SKELETON id; its data-text (+ the ▶ play's) is the CURRENT realization, re-patched on each swap.
function templateCardHtml(tpl, speaking, done) {
  const picks = tplPicks[tpl.id] || {};
  const r = realizeTemplate(tpl, picks);
  const grams = (tpl.grammar || []).map((g) => `<span class="st-tag">${escapeHtml(grammarLabel(g))}</span>`).join('');
  const rec = speaking && account ? recordControlHtml(SELFTALK_SCOPE, tpl.id, '', null, false, r.text, 'selftalk') : '';
  return `<div class="st-phrase st-template${done ? ' practiced' : ''}" data-id="${escapeHtml(tpl.id)}">
    <button class="speak-btn st-play" type="button" data-play data-text="${escapeHtml(r.text)}" aria-label="Play sentence" title="Play — ⌥/⇧-click to try another voice"><svg class="ic" aria-hidden="true"><use href="#i-volume"/></svg></button>
    <div class="st-phrase-text">
      <div class="jp st-jp st-template-jp">${templateSentenceHtml(tpl, picks)}</div>
      <div class="st-read">${escapeHtml(r.read)}</div>
      <div class="st-en">${escapeHtml(r.mean)}</div>
      <div class="st-phrase-meta"><span class="st-badge st-badge-tpl">template</span>${grams}<button class="st-shuffle" type="button" data-st-shuffle aria-label="Shuffle the slots" title="Shuffle"><svg class="ic" aria-hidden="true"><use href="#i-refresh"/></svg></button></div>
      <div class="st-bottom"><span class="st-done-slot">${doneSlotHtml(done)}</span>${rec}</div>
    </div>
  </div>`;
}

// Patch a template card IN PLACE after a slot swap — re-render the sentence/reading/English and the
// ▶ play + record-control data-text, WITHOUT tearing down the record control (which would drop an
// in-flight take / its waveform). The delegated handlers read data-text fresh at click time.
function repaintTemplateCard(card) {
  const tpl = storeTemplates.find((t) => t.id === card.dataset.id);
  if (!tpl) return;
  const picks = tplPicks[tpl.id] || {};
  const r = realizeTemplate(tpl, picks);
  const set = (sel, fn) => { const el = card.querySelector(sel); if (el) fn(el); };
  set('.st-template-jp', (el) => { el.innerHTML = templateSentenceHtml(tpl, picks); });
  set('.st-read', (el) => { el.textContent = r.read; });
  set('.st-en', (el) => { el.textContent = r.mean; });
  set('.st-play', (el) => { el.dataset.text = r.text; });
  set('.rec-control', (el) => { el.dataset.text = r.text; });
}

// Slot filler menu (⌥-click / long-press): only one open at a time.
function closeSlotMenus(root) { (root || document).querySelectorAll('.st-slot-menu:not([hidden])').forEach((m) => { m.hidden = true; }); }
function openSlotMenu(chip) { const menu = chip.parentElement && chip.parentElement.querySelector('.st-slot-menu'); if (!menu) return; closeSlotMenus(document); menu.hidden = false; }

function renderBody() {
  const body = elBody(); if (!body) return;
  if (stTopic === null) renderGrid(body); else renderTopic(body, stTopic);
}

// Drill in/out: swap #stBody to a topic (or back to the grid). The head + nav bar don't change, so
// only #stBody re-renders. Returning to the grid leaves any speaking mode intact (the nav toggle).
function drillTopic(id) { stTopic = id; renderBody(); }

// The grid: a pinned "Today's focus" cell over category sections of topic cells. Each cell carries a
// phrase tally + today's said-count; clicking drills in. No phrases render here, so there are no
// record controls — only the topic view has them.
function renderGrid(body) {
  const phrases = filteredPhrases();
  const templates = filteredTemplates();
  const items = phrases.concat(templates);
  if (!items.length) { body.innerHTML = `<div class="st-empty">No phrases match this filter.</div>`; return; }
  const today = localDay();
  const doneSet = donePhraseIds(state.selftalkStore.practice, today);
  const todayIds = new Set(todaysSet(phrases, today, TODAY_N));   // "today" is the daily PHRASE rotation
  const todayDone = [...todayIds].filter((id) => doneSet.has(id)).length;
  const grid = topicGrid(items, SELFTALK_TAXONOMY, doneSet);      // count phrases AND templates per cell
  const tplByTopic = {};
  for (const t of templates) tplByTopic[t.topic] = (tplByTopic[t.topic] || 0) + 1;
  // `count` is the total; split the templates back out so the cell reads honestly ("6 phrases · 5 templates").
  const tally = (count, done, tpls) => {
    const phr = count - (tpls || 0);
    const parts = [];
    if (phr > 0) parts.push(`${phr} phrase${phr === 1 ? '' : 's'}`);
    if (tpls) parts.push(`${tpls} template${tpls === 1 ? '' : 's'}`);
    return `<span class="st-cell-count">${done ? `<span class="done">${done} said</span> · ` : ''}${parts.join(' · ')}</span>`;
  };
  const cell = (t) =>
    `<button class="st-cell" type="button" data-st-topic="${escapeHtml(t.id)}">
       <span class="st-cell-label">${escapeHtml(t.label)}</span>
       ${t.jp ? `<span class="st-cell-jp">${escapeHtml(t.jp)}</span>` : ''}
       ${tally(t.count, t.done, tplByTopic[t.id])}
     </button>`;
  const catSection = (c) =>
    `<div class="st-cat"><p class="st-cat-head">${c.icon ? `<svg class="ic" aria-hidden="true"><use href="#${escapeHtml(c.icon)}"/></svg>` : ''}${escapeHtml(c.label)}${c.jp ? ` <span class="st-cat-jp">${escapeHtml(c.jp)}</span>` : ''}</p>
       <div class="st-grid">${c.topics.map(cell).join('')}</div></div>`;
  const todayCell = todayIds.size
    ? `<div class="st-grid st-today-grid"><button class="st-cell st-today-cell" type="button" data-st-topic="${TODAY_TOPIC}">
         <span class="st-today-row"><svg class="ic" aria-hidden="true"><use href="#i-target"/></svg><span class="st-cell-label">Today's focus</span></span>
         ${tally(todayIds.size, todayDone, 0)}
       </button></div>`
    : '';
  body.innerHTML = todayCell + grid.map(catSection).join('');
  wireWordTaps(body);   // harmless on the grid (no word spans); keeps the attach-once delegate live
}

// A drilled-in topic (or the rotating "today" set): a back button, the topic head (+ register
// badge), then the phrase list with the full record-and-compare rig. This is the only view that
// renders phrases, so wireRecordCompare / paintCompareWaveforms run here.
function renderTopic(body, topicId) {
  const today = localDay();
  const doneSet = donePhraseIds(state.selftalkStore.practice, today);
  const speaking = isSpeakingMode();
  const isToday = topicId === TODAY_TOPIC;
  let items = filteredPhrases();
  if (isToday) { const ids = new Set(todaysSet(items, today, TODAY_N)); items = items.filter((p) => ids.has(p.id)); }
  else {
    items = items.filter((p) => p.topic === topicId);
    // merge this topic's slot-swap templates (grammar-filtered like phrases), AFTER the phrases so a
    // thought cluster reads "practice these lines, then build your own."
    const tpls = templatesForTopic(topicId).filter((t) => !stGrammar.length || (t.grammar || []).some((g) => stGrammar.includes(g)));
    items = items.concat(tpls);
  }
  const meta = isToday ? null : SELFTALK_TOPICS.find((t) => t.id === topicId);
  const title = isToday ? "Today's focus" : (meta ? meta.label : topicId);
  const jp = isToday ? '' : (meta && meta.jp) || '';
  const register = meta && meta.register ? `<span class="st-register">${escapeHtml(registerLabel(meta.register))}</span>` : '';
  const head = `<button class="st-back" type="button" data-st-back><svg class="ic" aria-hidden="true"><use href="#i-chevron"/></svg>All topics</button>
    <div class="st-topic-head"><span class="st-topic-title">${escapeHtml(title)}</span>${jp ? `<span class="st-topic-jp">${escapeHtml(jp)}</span>` : ''}${register}</div>`;
  // a template (carries `slots`) renders the slot-swap card; a phrase renders the fixed card.
  const itemHtml = (it) => (it.slots ? templateCardHtml(it, speaking, doneSet.has(it.id)) : phraseCardHtml(it, speaking, doneSet.has(it.id)));
  const listHtml = (its) => `<div class="st-list">${its.map(itemHtml).join('')}</div>`;
  // Sub-group a real topic's items into "sentence thoughts" (labeled clusters); today's set + flat
  // topics render as a single ungrouped list. A loose group that coexists with labeled ones gets a
  // muted "More" heading so it doesn't read as part of the last cluster.
  let list;
  if (!items.length) list = `<div class="st-empty">No phrases match this filter.</div>`;
  else if (isToday) list = listHtml(items);
  else {
    const groups = groupByThought(items, meta && meta.thoughts);
    list = groups.some((g) => g.label)
      ? groups.map((g) => `<p class="st-thought">${escapeHtml(g.label || 'More')} <span class="st-count">${g.items.length}</span></p>${listHtml(g.items)}`).join('')
      : listHtml(items);
  }
  body.innerHTML = head + list;
  wireWordTaps(body);                          // delegated tap-to-lookup on the phrases' word spans
  wireRecordCompare(body);                     // delegated record/play/delete/compare (attach-once)
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
  const existing = id ? allPhrases().find((p) => p.id === id) : null;
  $('stPhScene').innerHTML = SELFTALK_TAXONOMY.map((c) =>
    `<optgroup label="${escapeHtml(c.label)}">${c.topics.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.label)}</option>`).join('')}</optgroup>`).join('');
  const sel = new Set(existing ? (existing.grammar || []) : []);
  $('stPhGram').innerHTML = SELFTALK_GRAMMAR.map((g) =>
    `<label class="st-gram-check"><input type="checkbox" value="${escapeHtml(g.id)}"${sel.has(g.id) ? ' checked' : ''}> ${escapeHtml(g.label)}</label>`).join('');
  $('stPhJp').value = existing ? existing.jp : '';
  $('stPhRead').value = existing ? (existing.read || '') : '';
  $('stPhMean').value = existing ? existing.mean : '';
  if (existing) $('stPhScene').value = existing.topic;
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

// Authoring writes PRIVATE rows to the sentence store via the API, OPTIMISTICALLY: the local set +
// cache update and the UI re-renders immediately, then the write confirms in the background (the
// usr-<uuid> id is final from birth → no reconciliation). A failed write surfaces "⚠ offline" but
// keeps the optimistic local copy. Requires an account (the Add affordance is account-gated).
async function savePhrase(e) {
  e.preventDefault();
  if (!account) { $('stPhErr').textContent = 'Sign in to save your own phrases.'; return; }
  const jp = $('stPhJp').value.trim(), mean = $('stPhMean').value.trim();
  if (!jp || !mean) { $('stPhErr').textContent = 'Japanese and English are required.'; return; }
  const editing = editingId;
  const body = phraseToSentence({
    id: editing || newPhraseId(),
    jp, read: $('stPhRead').value.trim(), mean,
    topic: $('stPhScene').value || SELFTALK_TOPICS[0].id,
    grammar: [...document.querySelectorAll('#stPhGram input:checked')].map((c) => c.value),
  });
  upsertLocalPhrase(sentenceToPhrase({ ...body, custom: true }));   // optimistic
  closePhraseModal();
  renderSelftalk();
  try {
    if (editing) await api('/v1/sentences/' + encodeURIComponent(body.id), { method: 'PUT', body: omitId(body) });
    else await api('/v1/sentences', { method: 'POST', body });
    setSyncStatus('✓ saved');
  } catch (err) { setSyncStatus('⚠ offline'); }
}
function omitId({ id, ...rest }) { return rest; }   // PUT carries the id in the path, not the body

async function deletePhrase() {
  if (!editingId) return;
  const id = editingId;
  removeLocalPhrase(id);   // optimistic
  closePhraseModal();
  renderSelftalk();
  try { await api('/v1/sentences/' + encodeURIComponent(id), { method: 'DELETE' }); setSyncStatus('✓ deleted'); }
  catch (err) { setSyncStatus('⚠ offline'); }
}

// ---- lifecycle ----
// Auto-exit when navigating away from the tab (chrome.js leaveSelftalk → main.js), so the mic
// never lingers. Mirrors minna.js onMinnaHidden.
export function onSelftalkHidden() { exitSpeakingMode(); clearNavSpeaking(); stTopic = null; }

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
  storePhrases = loadCachedPhrases();   // warm from the last good fetch so the first paint isn't blank
  // Background refresh at boot so the cache is fresh; re-render if the tab is already showing.
  refreshPhrases().then((changed) => {
    const panel = document.getElementById('panel-selftalk');
    if (changed && panel && panel.classList.contains('active')) renderSelftalk();
  });
  // Record a practice mark when a Self-Talk take is saved (engine host hook; ignores Minna takes).
  // Also materialize the recorded template combo (no-op for a plain phrase) — recording is the
  // strongest "I used this combo" signal, and it's already account-gated.
  setOnTakeSaved((scope, itemKey) => { if (scope === SELFTALK_SCOPE) { markPracticed(itemKey); reflectPracticed(itemKey); maybeMaterialize(itemKey); } });
  document.addEventListener('visibilitychange', handleBrowserTabHidden);

  const panel = document.getElementById('panel-selftalk');
  if (panel && !panel.dataset.stWired) {
    panel.dataset.stWired = '1';
    panel.addEventListener('click', (e) => {
      const play = e.target.closest('[data-play]');
      if (play) {
        playItem({ text: play.dataset.text || '' }, 'selftalk', play, { cycle: cycleMod(e) });
        const card = play.closest('.st-phrase');
        if (card) maybeMaterialize(card.dataset.id);   // template combo → materialize on first play (no-op for phrases)
        return;
      }
      const mark = e.target.closest('[data-stdone]');
      if (mark) { const card = mark.closest('.st-phrase'); if (card) { markPracticed(card.dataset.id); reflectPracticed(card.dataset.id); } return; }
      const ed = e.target.closest('[data-stedit]');
      if (ed) { const card = ed.closest('.st-phrase'); if (card) openPhraseModal(card.dataset.id); return; }
      const add = e.target.closest('[data-stadd]');
      if (add) { openPhraseModal(null); return; }
      const signin = e.target.closest('[data-stsignin]');
      if (signin) { document.getElementById('accountBtn').click(); return; }   // anon → open the sign-in modal
      const gram = e.target.closest('[data-stgram]');
      if (gram) { toggleGrammar(gram.dataset.stgram); return; }
      const topicCell = e.target.closest('[data-st-topic]');
      if (topicCell) { drillTopic(topicCell.dataset.stTopic); return; }
      const back = e.target.closest('[data-st-back]');
      if (back) { drillTopic(null); return; }
      // ---- slot-swap templates: pick from the menu / cycle / open menu / shuffle ----
      const pick = e.target.closest('[data-st-pick]');
      if (pick) {
        const card = pick.closest('.st-template'); if (!card) return;
        tplPicks[card.dataset.id] = { ...(tplPicks[card.dataset.id] || {}), [pick.dataset.stPick]: Number(pick.dataset.fill) || 0 };
        closeSlotMenus(card); repaintTemplateCard(card); return;
      }
      const slot = e.target.closest('[data-st-slot]');
      if (slot) {
        if (lpFired) { lpFired = false; return; }          // long-press already opened the menu
        const card = slot.closest('.st-template'); if (!card) return;
        const tpl = storeTemplates.find((t) => t.id === card.dataset.id); if (!tpl) return;
        if (cycleMod(e)) { openSlotMenu(slot); return; }   // ⌥/⇧-click → all options
        tplPicks[tpl.id] = cyclePick(tpl, tplPicks[tpl.id] || {}, slot.dataset.stSlot);
        closeSlotMenus(card); repaintTemplateCard(card); return;
      }
      const shuffle = e.target.closest('[data-st-shuffle]');
      if (shuffle) {
        const card = shuffle.closest('.st-template'); if (!card) return;
        const tpl = storeTemplates.find((t) => t.id === card.dataset.id); if (!tpl) return;
        const next = {};
        for (const s of tpl.slots || []) next[s.id] = Math.floor(Math.random() * ((s.fillers || []).length || 1));
        tplPicks[tpl.id] = next; closeSlotMenus(card); repaintTemplateCard(card); return;
      }
    });
    // Long-press a slot chip = the touch equivalent of ⌥-click (opens its filler menu); the ensuing
    // click is suppressed via lpFired so it doesn't also cycle.
    let lpTimer = null;
    const clearLp = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
    panel.addEventListener('pointerdown', (e) => {
      const chip = e.target.closest('.st-slot'); if (!chip) return;
      lpFired = false;
      lpTimer = setTimeout(() => { lpFired = true; openSlotMenu(chip); }, 450);
    });
    panel.addEventListener('pointerup', clearLp);
    panel.addEventListener('pointercancel', clearLp);
    panel.addEventListener('pointerleave', clearLp);
    // Click outside an open filler menu (and not on a chip) closes it.
    document.addEventListener('mousedown', (e) => {
      if (e.target.closest('.st-slot-menu') || e.target.closest('.st-slot')) return;
      closeSlotMenus(document);
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
