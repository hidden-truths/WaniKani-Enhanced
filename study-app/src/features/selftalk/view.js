// 独り言 Self-Talk — RENDER layer. #stBody is a two-level browse: a category→topic GRID (renderGrid)
// whose cells drill into a single topic's phrase list (renderTopic) — clicking a cell swaps #stBody
// in place, keeping it the stable attach-once record-compare container; a pinned "Today's focus" cell
// drills into the rotating daily set. Only ONE view renders at a time, so a phrase's record control
// never double-renders for the same (scope,itemKey) — the "Today's focus is a filter, not a duplicate
// section" invariant, preserved by drilling rather than stacking. This module owns the render entry
// (renderSelftalk/showSelftalk), the head, the phrase + slot-swap-template card builders, and the
// grid/topic views. State is the shared `S`; the data accessors live in store.js.
import { state } from '../../state.js';
import { localDay } from '../../config.js';
import {
  escapeHtml, rubyHtml, plainText, overlayTokens, topicGrid, groupByThought, grammarTokens,
  todaysSet, practiceStreak, donePhraseIds, realizeTemplate, templatePickIndex,
} from '../../core/index.js';
import { SELFTALK_TAXONOMY, SELFTALK_TOPICS, SELFTALK_GRAMMAR } from '../../data/selftalk.js';
import { speakBtnHtml } from '../render-helpers.js';
import { recordControlHtml, wireRecordCompare, paintCompareWaveforms, isSpeakingMode } from '../record-compare.js';
import { wireWordTaps } from '../word-lookup.js';
import { account } from '../cloud-core.js';
import { S, TODAY_N, TODAY_TOPIC, registerLabel, elHead, elBody, SELFTALK_SCOPE } from './state.js';
import {
  filteredPhrases, filteredTemplates, allPhrases, templatesForTopic, grammarLabel,
  refreshPhrases, refreshTemplates, warmTemplatesFromCache,
} from './store.js';
import { renderNavSpeaking } from './speaking.js';

// ---- render entry ----
export function renderSelftalk() {
  renderHead();
  renderBody();
  renderNavSpeaking();
}

// Tab-activation entry: paint from what we have (cache / last fetch) for an instant frame, refresh
// from the store, then repaint if the network set changed. Wired in main.js as the 独り言 tab's
// render handler (renderSelftalk stays the render-only fn used by the internal re-renders).
export async function showSelftalk() {
  if (!S.storeTemplates.length) warmTemplatesFromCache();   // instant frame from cache (templates)
  const hadCache = S.storePhrases.length > 0;
  if (hadCache) renderSelftalk();
  const [phrasesChanged, templatesChanged] = await Promise.all([refreshPhrases(), refreshTemplates()]);
  if (phrasesChanged || templatesChanged || !hadCache) renderSelftalk();
}

// ---- head (the editorial header: kicker + title + lede + streak/progress meta + grammar filter) ----
// Authoring writes PRIVATE server rows, so it requires an account; anon gets a sign-in nudge
// (reading stays anon). Mirrors how the record controls gate on `account`.
function addAffordanceHtml() {
  return account
    ? `<button class="chip primary" type="button" data-stadd><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg>Add your own phrase</button>`
    : `<button class="chip" type="button" data-stsignin><svg class="ic" aria-hidden="true"><use href="#i-user"/></svg>Sign in to add your own phrases</button>`;
}

export function renderHead() {
  const head = elHead(); if (!head) return;
  const toks = grammarTokens(allPhrases(), SELFTALK_GRAMMAR.map((g) => g.id));
  const allActive = !S.stGrammar.length;
  const gramChip = (tok, label, on) =>
    `<button class="chip st-gram${on ? ' active' : ''}" type="button" data-stgram="${escapeHtml(tok)}" aria-pressed="${on}">${escapeHtml(label)}</button>`;
  const chips = toks.map((t) => gramChip(t, grammarLabel(t), S.stGrammar.includes(t))).join('');
  // streak + said-today fold into the header meta pills (the mock's "12-day streak · today 3/5").
  const pr = (state.selftalkStore && state.selftalkStore.practice) || {};
  const today = localDay();
  const streak = practiceStreak(pr, today);
  const done = donePhraseIds(pr, today).size;
  head.innerHTML = `
    <section class="page-head st-head">
      <div>
        <div class="marker"><div class="idx">06<span class="slash"> / 08</span></div><div class="ttl jp-min">独り言</div><div class="en">Self-talk</div><div class="rule"></div></div>
        <h1 class="page-title">Say it out loud <span class="jp st-title-jp">声に出して</span></h1>
        <p class="st-lede">Read the phrase, hear a model voice, then <b>say it yourself</b> and mark it — ⌥/⇧-click ▶ to try another voice.</p>
      </div>
      <div class="page-counts">
        ${streak > 0 ? `<span class="pill"><span class="dot"></span><b>${streak}-day</b>&nbsp;streak</span>` : `<span class="pill"><span class="dot"></span>start a streak</span>`}
        ${done ? `<span class="pill st-today"><span class="dot"></span><b>${done}</b>&nbsp;said today</span>` : ''}
      </div>
    </section>
    <div class="st-actions">${addAffordanceHtml()}</div>
    <div class="frow"><span class="filter-label">Grammar</span>
      <div class="chips" role="group" aria-label="Grammar filter">${gramChip('all', 'All', allActive)}${chips}</div></div>`;
}

// ---- phrase + slot-swap-template cards ----
export function doneSlotHtml(done) {
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
    ${speakBtnHtml({ cls: 'st-play', data: { play: true, text }, label: 'Play phrase', title: 'Play — ⌥/⇧-click to try another voice' })}
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
  const picks = S.tplPicks[tpl.id] || {};
  const r = realizeTemplate(tpl, picks);
  const grams = (tpl.grammar || []).map((g) => `<span class="st-tag">${escapeHtml(grammarLabel(g))}</span>`).join('');
  const rec = speaking && account ? recordControlHtml(SELFTALK_SCOPE, tpl.id, '', null, false, r.text, 'selftalk') : '';
  return `<div class="st-phrase st-template${done ? ' practiced' : ''}" data-id="${escapeHtml(tpl.id)}">
    ${speakBtnHtml({ cls: 'st-play', data: { play: true, text: r.text }, label: 'Play sentence', title: 'Play — ⌥/⇧-click to try another voice' })}
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
export function repaintTemplateCard(card) {
  const tpl = S.storeTemplates.find((t) => t.id === card.dataset.id);
  if (!tpl) return;
  const picks = S.tplPicks[tpl.id] || {};
  const r = realizeTemplate(tpl, picks);
  const set = (sel, fn) => { const el = card.querySelector(sel); if (el) fn(el); };
  set('.st-template-jp', (el) => { el.innerHTML = templateSentenceHtml(tpl, picks); });
  set('.st-read', (el) => { el.textContent = r.read; });
  set('.st-en', (el) => { el.textContent = r.mean; });
  set('.st-play', (el) => { el.dataset.text = r.text; });
  set('.rec-control', (el) => { el.dataset.text = r.text; });
}

// Slot filler menu (⌥-click / long-press): only one open at a time.
export function closeSlotMenus(root) { (root || document).querySelectorAll('.st-slot-menu:not([hidden])').forEach((m) => { m.hidden = true; }); }
export function openSlotMenu(chip) { const menu = chip.parentElement && chip.parentElement.querySelector('.st-slot-menu'); if (!menu) return; closeSlotMenus(document); menu.hidden = false; }

// ---- body: grid ⇄ drilled-in topic ----
function renderBody() {
  const body = elBody(); if (!body) return;
  if (S.stTopic === null) renderGrid(body); else renderTopic(body, S.stTopic);
}

// Drill in/out: swap #stBody to a topic (or back to the grid). The head + nav bar don't change, so
// only #stBody re-renders. Returning to the grid leaves any speaking mode intact (the nav toggle).
export function drillTopic(id) { S.stTopic = id; renderBody(); }

// Pick a daily prompt into the "Now speaking" featured card (the rail). Re-renders the grid body so
// the featured card swaps + the rail's .current marker moves; a different prompt resets the record area.
export function featureDaily(id) { S.stFeatured = id; renderBody(); }

// The grid (the default 独り言 view, HYBRID): the daily-5 — a "Now speaking" FEATURED card over a
// "Today's prompts" rail — atop the category→topic browser (kept as the superset). Only the featured
// card renders a phrase (with its record control); the rail cards + topic cells don't, so the
// one-record-control-per-(scope,id)-per-view invariant holds (grid ⇄ topic still render one at a time).
function renderGrid(body) {
  const phrases = filteredPhrases();
  const templates = filteredTemplates();
  const items = phrases.concat(templates);
  if (!items.length) { body.innerHTML = `<div class="st-empty">No phrases match this filter.</div>`; return; }
  const today = localDay();
  const doneSet = donePhraseIds(state.selftalkStore.practice, today);
  const speaking = isSpeakingMode();

  // ---- daily-5: a "Now speaking" featured card + the "Today's prompts" rail ----
  const daily = todaysSet(phrases, today, TODAY_N).map((id) => phrases.find((p) => p.id === id)).filter(Boolean);
  let dailyHtml = '';
  if (daily.length) {
    // featured = the chosen prompt, else the first not-yet-said, else the first (so you land on what's next).
    const featured = daily.find((p) => p.id === S.stFeatured) || daily.find((p) => !doneSet.has(p.id)) || daily[0];
    const railCard = (p, i) => {
      const done = doneSet.has(p.id);
      return `<button class="st-rail-card${p.id === featured.id ? ' current' : ''}${done ? ' done' : ''}" type="button" data-st-feature="${escapeHtml(p.id)}">
        <span class="st-rail-num">${done ? '<svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>' : i + 1}</span>
        <span class="st-rail-text">${escapeHtml(p.mean)}</span>
      </button>`;
    };
    dailyHtml = `<section class="st-daily">
      <div class="st-now">
        <div class="st-now-head"><span class="st-eq" aria-hidden="true"><i></i><i></i><i></i></span> Now speaking</div>
        ${phraseCardHtml(featured, speaking, doneSet.has(featured.id))}
      </div>
      <aside class="st-rail">
        <p class="st-rail-head"><svg class="ic" aria-hidden="true"><use href="#i-target"/></svg> Today&rsquo;s prompts <span class="st-count">${daily.length}</span></p>
        <div class="st-rail-list">${daily.map(railCard).join('')}</div>
      </aside>
    </section>`;
  }

  // ---- the category→topic browser (kept below as the superset) ----
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
  const browse = `<section class="st-browse"><p class="st-browse-head">Browse all topics <span class="line-rule"></span></p>${grid.map(catSection).join('')}</section>`;
  body.innerHTML = dailyHtml + browse;
  wireWordTaps(body);            // the featured card's word spans (+ keeps the attach-once delegate live)
  wireRecordCompare(body);       // the featured card's record/play/delete/compare (attach-once)
  if (speaking) paintCompareWaveforms(body);
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
    const tpls = templatesForTopic(topicId).filter((t) => !S.stGrammar.length || (t.grammar || []).some((g) => S.stGrammar.includes(g)));
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

// ---- grammar / view filters ----
export function toggleGrammar(tok) {
  if (tok === 'all') S.stGrammar = [];
  else if (S.stGrammar.includes(tok)) S.stGrammar = S.stGrammar.filter((t) => t !== tok);
  else S.stGrammar = S.stGrammar.concat(tok);
  renderSelftalk();
}
