// Integration test for the DECK-BUILDING glue (src/features/deck.js) — the filter-model wiring +
// buildDeck ordering + the "Review due cards" deep-link, previously hand-verified only (the ROADMAP
// core-testing-debt item). The pure facet/SRS predicates are core-tested; this drives the REAL
// module's DOM layer under happy-dom: chip wiring (wireFacets master-"all"), the SRS due filter,
// the three orderings, the rank-range clamp/swap, and the due-banner states.
//
// It also PINS the two startDueSession fixes: the deep-link must reset ALL six DECK_FACETS (cat was
// missed when the Category facet landed — a stale category silently narrowed "review everything
// due") and must range to state.MAXRANK, not a hardcoded 100 (which excluded every due
// custom/Minna/song card, all ranked above 100).
//
// Fixture + initDeckUI run ONCE (module scope) — the chip listeners bind at init, so a re-created
// fixture would be unwired. Tests reset cfg/state, not the wiring.
import { test, expect, beforeEach, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ settings: { input: 'self', audio: 'off', freeReviewDue: true, exampleLevel: 'N5' } }));
vi.mock('../src/settings-store.js', () => ({ settings: ctx.settings, saveSettings: vi.fn() }));

import { state } from '../src/state.js';
import { cfg, buildDeck, initDeckUI, startDueSession, registerStartSession, updateDeckCount, updateDueBanner } from '../src/features/deck.js';
import { CONJ_FORM_IDS } from '../src/core/conjugation.js';

document.body.innerHTML = `
  <div id="panel-study">
    <button id="startBtn"></button>
    <div id="dueBanner"><span id="dueCount"></span><button id="dueBtn"></button></div>
    <span id="heroStreak" hidden><b></b></span><span id="heroStudied"></span>
    <div id="forecastChart"></div><div id="pipeViz"></div>
    <div class="chips">
      <button class="chip mode" data-mode="meaning"></button>
      <button class="chip mode" data-mode="conjugation"></button>
      <button class="chip skind" data-skind="free"></button><button class="chip skind" data-skind="srs"></button>
      <button class="chip imode" data-imode="self"></button>
      <button class="chip amode" data-amode="off"></button>
      <button class="chip deck" data-deck="all"></button>
      <button class="chip deck" data-deck="godan"></button>
      <button class="chip deck" data-deck="noun"></button>
      <button class="chip deck" data-deck="motion"></button>
      <button class="chip jlpt" data-jlpt="all"></button><button class="chip jlpt" data-jlpt="N5"></button>
      <button class="chip ord" data-ord="shuffle"></button><button class="chip ord" data-ord="worst"></button>
      <div class="frow verb-only"></div>
    </div>
    <div class="frow" id="conjFormsRow" hidden><div class="chips" id="conjForms"></div></div>
    <input id="rmin"><input id="rmax">
    <div id="deckCount"></div><div id="deckSummary"></div>
  </div>`;

const el = (id) => document.getElementById(id);
const chip = (attr, val) => document.querySelector(`.chip[data-${attr}="${val}"]`);
const DAY = 86400000;
const CARD = (rank, extra = {}) => ({ rank, jp: `w${rank}`, read: `r${rank}`, mean: `m${rank}`, jlpt: 'N5', cat: 'verb', type: 'godan', trans: 't', tags: [], ...extra });

// The three-card corpus: a godan verb (motion), an ichidan verb, a (custom-range) noun.
function seedData() {
  state.DATA = [
    CARD(1, { tags: ['motion'] }),
    CARD(2, { type: 'ichidan', jlpt: 'N4' }),
    CARD(105, { cat: 'noun', type: '', trans: '', tags: ['time'] }),
  ];
  state.MAXRANK = 105;
}

state.store = { cards: {}, sessions: [], daily: {} };
seedData();
initDeckUI();   // wires the chips once; cfg.rmax finalizes to MAXRANK here

const CFG_DEFAULTS = { mode: 'meaning', kind: 'free', ord: 'shuffle', rmin: 1, rmax: 105, jlpt: ['all'] };
beforeEach(() => {
  state.store = { cards: {}, sessions: [], daily: {} };
  seedData();
  Object.assign(cfg, CFG_DEFAULTS, { cat: [], type: [], trans: [], topic: [], status: [], source: [], forms: [...CONJ_FORM_IDS] });
  document.querySelectorAll('.chip.conjf').forEach(b => b.classList.add('active'));
});

// A corpus with REAL readings — the default CARD fixture's `r1`/`r2` readings can't inflect
// (they don't end in a dictionary-form kana), which is itself the point of the first test below.
function seedConjugable() {
  state.DATA = [
    { rank: 1, jp: '食べる', read: 'たべる', mean: 'eat', jlpt: 'N5', cat: 'verb', type: 'ichidan', trans: 't', tags: [] },
    { rank: 2, jp: 'ある', read: 'ある', mean: 'exist', jlpt: 'N5', cat: 'verb', type: 'godan', trans: 'i', tags: [] },
    { rank: 3, jp: '猫', read: 'ねこ', mean: 'cat', jlpt: 'N5', cat: 'noun', type: '', trans: '', tags: [] },
  ];
  state.MAXRANK = 105;
}

test('buildDeck honors the AND’d facets, and the "all" chip is a master reset across facets', () => {
  expect(buildDeck().map(v => v.rank).sort((a, b) => a - b)).toEqual([1, 2, 105]);
  chip('deck', 'godan').click();                       // type facet
  expect(buildDeck().map(v => v.rank)).toEqual([1]);
  chip('deck', 'motion').click();                      // AND a topic: godan AND motion
  expect(buildDeck().map(v => v.rank)).toEqual([1]);
  chip('deck', 'noun').click();                        // AND cat noun → intersection is empty
  expect(buildDeck()).toEqual([]);
  chip('deck', 'all').click();                         // master reset clears every facet
  expect(cfg.cat).toEqual([]); expect(cfg.type).toEqual([]); expect(cfg.topic).toEqual([]);
  expect(buildDeck()).toHaveLength(3);
});

test('an SRS deck is due cards only (new box-0 cards count as due)', () => {
  state.store.cards[1] = { attempts: [], right: 0, wrong: 0, box: 1, due: Date.now() - DAY };  // due
  state.store.cards[2] = { attempts: [], right: 0, wrong: 0, box: 2, due: Date.now() + DAY };  // not due
  cfg.kind = 'srs';                                                                            // 105 unseen → due
  expect(buildDeck().map(v => v.rank).sort((a, b) => a - b)).toEqual([1, 105]);
});

test('ordering: freq sorts by rank; worst-first puts poor accuracy first and never-drilled last', () => {
  cfg.ord = 'freq';
  expect(buildDeck().map(v => v.rank)).toEqual([1, 2, 105]);
  state.store.cards[105] = { attempts: [0, 0, 1], right: 1, wrong: 2, box: 1, due: 0 };
  cfg.ord = 'worst';
  expect(buildDeck()[0].rank).toBe(105);               // drilled at 33% sorts ahead of the undrilled (treated as 100%)
});

test('startDueSession resets ALL six facets (cat included) and ranges to MAXRANK, not 100', () => {
  const onStart = vi.fn();
  registerStartSession(onStart);
  Object.assign(cfg, { cat: ['noun'], type: ['godan'], topic: ['motion'], source: ['minna'], jlpt: ['N5'], rmax: 50 });
  startDueSession();
  expect(cfg).toMatchObject({ kind: 'srs', cat: [], type: [], trans: [], topic: [], source: [], status: ['due'], jlpt: ['all'], ord: 'worst', rmin: 1, rmax: 105 });
  expect(el('rmax').value).toBe('105');
  expect(onStart).toHaveBeenCalledOnce();
  // The regression this pins: rank-105 due cards (custom/Minna/song) belong in the due session.
  cfg.kind = 'srs';
  expect(buildDeck().map(v => v.rank)).toContain(105);
});

test('rank-range inputs clamp to [1, MAXRANK] and auto-swap when lo > hi', () => {
  el('rmin').value = '90'; el('rmax').value = '10';
  el('rmin').dispatchEvent(new Event('change'));
  expect(cfg.rmin).toBe(10); expect(cfg.rmax).toBe(90);          // swapped
  el('rmin').value = '-5'; el('rmax').value = '999';
  el('rmax').dispatchEvent(new Event('change'));
  expect(cfg.rmin).toBe(1); expect(cfg.rmax).toBe(105);          // clamped
});

test('the due banner: live count + disabled "All caught up" state at zero', () => {
  state.store.cards[1] = { attempts: [], right: 0, wrong: 0, box: 1, due: Date.now() - DAY };
  state.store.cards[2] = { attempts: [], right: 0, wrong: 0, box: 5, due: Date.now() + 10 * DAY };
  state.store.cards[105] = { attempts: [], right: 0, wrong: 0, box: 5, due: Date.now() + 10 * DAY };
  updateDueBanner();
  expect(el('dueCount').textContent).toBe('1');
  expect(el('dueBtn').disabled).toBe(false);
  state.store.cards[1].due = Date.now() + DAY;                    // nothing due now
  updateDueBanner();
  expect(el('dueCount').textContent).toBe('0');
  expect(el('dueBanner').classList.contains('empty')).toBe(true);
  expect(el('dueBtn').disabled).toBe(true);
  expect(el('dueBtn').textContent).toContain('All caught up');
});

test('updateDeckCount reflects the kind: cards-in-deck vs due-in-deck', () => {
  updateDeckCount();
  expect(el('deckCount').textContent).toContain('3');
  expect(el('deckCount').textContent).toContain('cards in deck');
  cfg.kind = 'srs';                                               // all three unseen → all due
  updateDeckCount();
  expect(el('deckCount').textContent).toContain('due in this deck');
});

/* ---- Conjugation mode (cfg.mode='conjugation' + cfg.forms) ----
   The picker's Forms row is NOT a deck facet: it filters which QUESTION a card is asked, and
   only indirectly which cards survive (a card with no answerable form drops out). These pin the
   narrowing, the ≥1-form floor, and the row's visibility toggle. */

test('conjugation mode narrows the deck to cards core/conjugation.js can actually inflect', () => {
  seedConjugable();
  cfg.mode = 'meaning';
  expect(buildDeck().map(v => v.rank).sort()).toEqual([1, 2, 3]);   // the noun rides along normally
  cfg.mode = 'conjugation';
  expect(buildDeck().map(v => v.rank).sort()).toEqual([1, 2]);      // …and drops out here
  // ある has no potential form, so a potential-only session drops it too — leaving 食べる alone.
  cfg.forms = ['potential'];
  expect(buildDeck().map(v => v.rank)).toEqual([1]);
});

test('the deck COUNT applies the same conjugation narrowing as buildDeck (no phantom cards)', () => {
  seedConjugable();
  cfg.mode = 'conjugation';
  cfg.forms = ['potential'];
  updateDeckCount();
  expect(el('deckCount').textContent).toContain('1');
  expect(el('deckSummary').textContent).toContain('可能形');   // the mode is named in the recap
});

test('a deck of non-inflectable cards is legitimately empty in conjugation mode', () => {
  // The default corpus: readings like `r1` that end in no dictionary-form kana.
  cfg.mode = 'conjugation';
  expect(buildDeck()).toEqual([]);
});

test('the Forms row appears only in conjugation mode', () => {
  chip('mode', 'meaning').click();
  expect(el('conjFormsRow').hidden).toBe(true);
  chip('mode', 'conjugation').click();
  expect(el('conjFormsRow').hidden).toBe(false);
  expect(document.querySelectorAll('.chip.conjf').length).toBe(CONJ_FORM_IDS.length);
  chip('mode', 'meaning').click();                  // …and hides again on the way out
  expect(el('conjFormsRow').hidden).toBe(true);
});

test('form chips toggle, but the LAST active form cannot be deselected (deck can never be emptied)', () => {
  seedConjugable();
  chip('mode', 'conjugation').click();
  const teChip = document.querySelector('.chip.conjf[data-conjf="te"]');
  const pastChip = document.querySelector('.chip.conjf[data-conjf="past"]');
  expect(cfg.forms).toEqual(CONJ_FORM_IDS);

  teChip.click();
  expect(cfg.forms).not.toContain('te');
  expect(teChip.classList.contains('active')).toBe(false);

  teChip.click();                                   // toggles back on
  expect(cfg.forms).toContain('te');
  expect(teChip.classList.contains('active')).toBe(true);

  // Strip down to one form, then try to remove it.
  cfg.forms.splice(0, cfg.forms.length, 'past');
  document.querySelectorAll('.chip.conjf').forEach(b => b.classList.toggle('active', b.dataset.conjf === 'past'));
  pastChip.click();
  expect(cfg.forms).toEqual(['past']);              // no-op — the floor held
  expect(pastChip.classList.contains('active')).toBe(true);
});
