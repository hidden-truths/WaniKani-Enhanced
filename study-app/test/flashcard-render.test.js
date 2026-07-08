// Integration test for the FLASHCARD SESSION lifecycle glue (src/features/flashcard.js) — the app's
// core loop, previously hand-verified only (the ROADMAP core-testing-debt item). Imports the real
// module and drives startSession → showCard → reveal/submitTyped → grade → endSession under
// happy-dom, with deck/tts/audio/persistence mocked. The high-value assertions are the GRADING
// GATES the docs call load-bearing: an SRS session schedules a due card, free study only reschedules
// a due card when freeReviewDue allows, and an early (not-due) review NEVER promotes — plus the
// session accounting (results, daily totals, the local cap, the injected durable-log hook) and the
// typed-mode advisory verdict.
//
// The fixture + initFlashcardUI run ONCE (module scope): the keyboard handler binds to `document`,
// so re-wiring per test would stack handlers and double-grade. Tests reset state, not the wiring.
import { test, expect, beforeEach, vi } from 'vitest';

const ctx = vi.hoisted(() => ({
  cfg: { mode: 'meaning', forms: ['te', 'past', 'negative', 'potential'], input: 'reveal', kind: 'srs', jlpt: [], status: [] },
  deck: [],
  settings: { exampleLevel: 'N5', furigana: true, input: 'reveal', audio: 'off', freeReviewDue: true },
}));
vi.mock('../src/features/deck.js', () => ({
  cfg: ctx.cfg,
  buildDeck: () => ctx.deck,
  updateDeckCount: () => {},
  updateDueBanner: () => {},
  updateStartLabel: () => {},
  startDueSession: () => {},
}));
vi.mock('../src/settings-store.js', () => ({ settings: ctx.settings, saveSettings: vi.fn() }));
vi.mock('../src/persistence/store.js', () => ({ save: vi.fn() }));
vi.mock('../src/features/tts.js', () => ({ TTS_OK: true, speak: vi.fn(), speakWord: vi.fn() }));
vi.mock('../src/features/audio.js', () => ({ cycleMod: () => false }));
vi.mock('../src/features/word-lookup.js', () => ({ wireWordTaps: () => {} }));
// The grammar catalog singleton, mocked with one two-example point (drives the cloze branch).
const GP = vi.hoisted(() => ({
  point: {
    id: 'you-ni-naru', label: '〜ようになる', read: 'ようになる', mean: 'come to', jlpt: 'N3',
    explanation: 'Change of state.', formation: 'V-dict + ようになる',
    examples: [
      { jp: '<ruby>泳<rt>およ</rt></ruby>げるようになった。', en: 'Became able to swim.', blank: 'ようになった' },
      { jp: '<ruby>起<rt>お</rt></ruby>きるようになる。', en: 'Come to get up.', blank: 'ようになる' },
    ],
  },
}));
vi.mock('../src/features/grammar/data.js', () => ({
  grammarPointOf: (id) => (id === GP.point.id ? GP.point : null),
  grammarTokensFor: () => null,
  ensureGrammarPoints: () => Promise.resolve([GP.point]),
}));

import { state } from '../src/state.js';
import { startSession, initFlashcardUI, registerSessionHooks, session } from '../src/features/flashcard.js';

// Every element flashcard.js touches (the #panel-study markup it expects from index.html).
document.body.innerHTML = `
  <div id="fcSetup"></div>
  <button id="startBtn"></button><button id="dueBtn"></button>
  <div id="fcStage">
    <div id="fcProgress"></div><div id="sessAcc"></div><div id="sessFill"></div>
    <div id="flashcard">
      <span id="cardBullet"></span><span id="cardClsJp"></span><span id="cardClsEn"></span>
      <div id="promptFace">
        <div id="promptLabel"></div><div id="promptWord"></div><div id="promptTags"></div>
        <div id="revealRow"><button id="revealBtn"></button></div>
        <div id="inputRow"><input id="answerInput"><button id="checkBtn"></button></div>
      </div>
      <div id="answer">
        <div id="cardHanko"><span id="hankoGlyph"></span></div>
        <div id="answerWord"></div><div id="aRead"></div><div id="aAccent" hidden></div>
        <div id="aMean"></div><div id="aTags"></div><div id="aNote"></div>
        <div id="veilLabelA"></div><div id="veilLabelB"></div>
        <div id="typedVerdict" hidden></div>
        <button id="speakBtn"></button>
        <div id="exampleBlock" hidden><div id="exLevels"></div><div id="exJp"></div><div id="exEn"></div>
          <button id="exSpeak"></button><button id="exCopy"></button></div>
      </div>
      <div id="gradeRow"><button id="wrongBtn"></button><button id="rightBtn"></button></div>
    </div>
    <button id="endBtn"></button>
  </div>
  <div id="fcDone"><div id="doneScore"></div><div id="doneDetail"></div><button id="againBtn"></button></div>`;
initFlashcardUI();

const el = (id) => document.getElementById(id);
const key = (k, code) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, code, bubbles: true, cancelable: true }));
const CARD = (rank, jp, read, extra = {}) => ({ rank, jp, read, mean: `meaning-${rank}`, jlpt: 'N5', cat: 'verb', type: 'ichidan', ...extra });
const DAY = 86400000;

const hooks = { logSession: vi.fn(), maybeShowSignup: vi.fn() };
registerSessionHooks(hooks);

beforeEach(() => {
  state.store = { cards: {}, sessions: [], daily: {} };
  state.exampleLevels = {};
  Object.assign(ctx.cfg, { mode: 'meaning', forms: ['te', 'past', 'negative', 'potential'], input: 'reveal', kind: 'srs' });
  ctx.settings.freeReviewDue = true;
  ctx.deck = [];
  hooks.logSession.mockClear(); hooks.maybeShowSignup.mockClear();
  el('fcStage').classList.remove('active'); el('fcDone').classList.remove('active');
  el('fcSetup').style.display = '';
});

test('an empty SRS deck offers to switch to Free study; declining stays on the picker', () => {
  const confirm = vi.fn(() => false);   // user declines the switch
  const alert = vi.fn();
  vi.stubGlobal('confirm', confirm); vi.stubGlobal('alert', alert);
  startSession();
  expect(confirm).toHaveBeenCalledOnce();
  expect(alert).not.toHaveBeenCalled();
  expect(ctx.cfg.kind).toBe('srs');                              // unchanged
  expect(el('fcStage').classList.contains('active')).toBe(false);
  vi.unstubAllGlobals();
});

test('an empty SRS deck: accepting flips to Free study (still-empty deck then plainly alerts)', () => {
  const confirm = vi.fn(() => true);    // user accepts the switch
  const alert = vi.fn();
  vi.stubGlobal('confirm', confirm); vi.stubGlobal('alert', alert);
  startSession();
  expect(ctx.cfg.kind).toBe('free');                             // flipped
  expect(alert).toHaveBeenCalledOnce();                          // re-run as free, still empty → the plain alert
  expect(el('fcStage').classList.contains('active')).toBe(false);
  vi.unstubAllGlobals();
});

test('SRS session: reveal → grade records attempts and schedules NEW (due) cards; ending shows the score and fires the durable-log hook', () => {
  ctx.deck = [CARD(1, '食べる', 'たべる'), CARD(2, '飲む', 'のむ', { type: 'godan' })];
  startSession();
  expect(el('fcStage').classList.contains('active')).toBe(true);
  expect(el('promptWord').innerHTML).toBe('食べる');           // meaning mode: JP is the prompt
  expect(el('fcProgress').textContent).toContain('1');

  el('revealBtn').click();
  expect(el('answer').classList.contains('show')).toBe(true);
  el('rightBtn').click();                                      // card 1 correct
  expect(state.store.cards[1]).toMatchObject({ attempts: [1], right: 1, wrong: 0, box: 1 });
  expect(state.store.cards[1].due).toBeGreaterThan(Date.now());
  expect(el('promptWord').innerHTML).toBe('飲む');              // advanced to card 2

  el('revealBtn').click();
  el('wrongBtn').click();                                      // card 2 wrong → lapse to box 1
  expect(state.store.cards[2]).toMatchObject({ attempts: [0], right: 0, wrong: 1, box: 1 });

  // Session over: local charts record + daily totals + the injected hooks.
  expect(el('fcDone').classList.contains('active')).toBe(true);
  expect(el('doneScore').textContent).toBe('50%');
  expect(state.store.sessions).toHaveLength(1);
  expect(state.store.sessions[0]).toMatchObject({ right: 1, tot: 2, kind: 'srs' });
  const day = Object.keys(state.store.daily)[0];
  expect(state.store.daily[day]).toEqual({ right: 1, tot: 2 });
  expect(hooks.logSession).toHaveBeenCalledWith(1, 2, 'srs');
  expect(hooks.maybeShowSignup).toHaveBeenCalledOnce();
});

test('free study on a DUE card only reschedules when freeReviewDue allows (accuracy always records)', () => {
  // A due card: box 1, due in the past.
  const dueCard = () => { state.store.cards[7] = { attempts: [], right: 0, wrong: 0, box: 1, due: Date.now() - DAY }; };
  ctx.cfg.kind = 'free';
  ctx.deck = [CARD(7, '見る', 'みる')];

  ctx.settings.freeReviewDue = false;
  dueCard();
  startSession(); el('revealBtn').click(); el('rightBtn').click();
  expect(state.store.cards[7].box).toBe(1);                    // schedule untouched
  expect(state.store.cards[7].due).toBeLessThan(Date.now());
  expect(state.store.cards[7]).toMatchObject({ attempts: [1], right: 1 }); // stats still recorded

  ctx.settings.freeReviewDue = true;
  dueCard();
  startSession(); el('revealBtn').click(); el('rightBtn').click();
  expect(state.store.cards[7].box).toBe(2);                    // now it advances
  expect(state.store.cards[7].due).toBeGreaterThan(Date.now());
});

test('reviewing a NOT-due card early never promotes it — even in an SRS session', () => {
  state.store.cards[9] = { attempts: [], right: 0, wrong: 0, box: 3, due: Date.now() + 2 * DAY };
  ctx.deck = [CARD(9, '行く', 'いく', { type: 'godan' })];
  startSession(); el('revealBtn').click(); el('rightBtn').click();
  expect(state.store.cards[9].box).toBe(3);                    // unchanged
  expect(state.store.cards[9].due).toBeGreaterThan(Date.now());
  expect(state.store.cards[9].attempts).toEqual([1]);          // accuracy still recorded
});

test('typed mode: romaji folds to kana, the verdict is ADVISORY (suggested ring), and the click still decides', () => {
  ctx.cfg.input = 'type';
  ctx.deck = [CARD(1, '食べる', 'たべる')];
  startSession();
  expect(el('inputRow').style.display).toBe('flex');
  expect(el('revealRow').style.display).toBe('none');
  const inp = el('answerInput');
  inp.value = 'taberu';
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  expect(el('typedVerdict').hidden).toBe(false);
  expect(el('typedVerdict').className).toContain('ok');
  expect(el('rightBtn').classList.contains('suggested')).toBe(true);
  expect(inp.disabled).toBe(true);                             // double-submit guard
  el('wrongBtn').click();                                      // the user overrides the suggestion
  expect(state.store.cards[1]).toMatchObject({ attempts: [0], wrong: 1 });
});

test('keyboard grading: 2 = correct, x = wrong, only while revealed', () => {
  ctx.deck = [CARD(1, '食べる', 'たべる'), CARD(2, '飲む', 'のむ', { type: 'godan' })];
  startSession();
  key('2');                                                     // not revealed yet → ignored
  expect(state.store.cards[1]).toBeUndefined();
  key('Enter');                                                 // flips the card
  expect(el('answer').classList.contains('show')).toBe(true);
  key('2');                                                     // grade correct
  expect(state.store.cards[1]).toMatchObject({ attempts: [1], right: 1 });
  key('Enter');                                                 // card 2: flip…
  key('x');                                                     // …grade wrong
  expect(state.store.cards[2]).toMatchObject({ attempts: [0], wrong: 1 });
});

test('ending with nothing graded returns to the picker without a score card', () => {
  ctx.deck = [CARD(1, '食べる', 'たべる')];
  startSession();
  el('endBtn').click();
  expect(el('fcDone').classList.contains('active')).toBe(false);
  expect(el('fcSetup').style.display).toBe('block');
  expect(state.store.sessions).toHaveLength(0);
  expect(hooks.logSession).not.toHaveBeenCalled();
});

const GRAMMAR_CARD = { rank: 301, jp: '〜ようになる', read: 'ようになる', mean: 'come to', jlpt: 'N3', cat: 'grammar', type: '', trans: '', tags: ['文法'], grammar: true, grammarId: 'you-ni-naru' };

test('grammar card: cloze prompt hides the pattern, typed mode is forced off, 法 hanko', () => {
  ctx.cfg.input = 'type';                                       // grammar overrides typed mode per-card
  ctx.deck = [GRAMMAR_CARD];
  startSession();
  expect(el('promptLabel').textContent).toBe('Grammar · fill the blank');
  const prompt = el('promptWord');
  expect(prompt.className).toContain('gp-cloze');
  expect(prompt.innerHTML).toContain('cloze-gap');
  expect(prompt.innerHTML).toContain('<ruby>泳<rt>およ</rt></ruby>');
  expect(prompt.innerHTML).not.toContain('ようになった');        // the answer is hidden
  expect(el('hankoGlyph').textContent).toBe('法');
  expect(el('inputRow').style.display).toBe('none');            // self-graded despite input:type
  expect(el('revealRow').style.display).toBe('flex');
});

test('grammar card reveal: pattern + meaning + explanation/formation notes + the marked full sentence; grading stamps `last`', () => {
  ctx.deck = [GRAMMAR_CARD];
  startSession();
  el('revealBtn').click();
  expect(el('answerWord').textContent).toBe('〜ようになる');
  expect(el('aMean').textContent).toBe('come to');
  expect(el('aNote').innerHTML).toContain('Change of state.');
  expect(el('aNote').innerHTML).toContain('V-dict + ようになる');
  expect(el('exampleBlock').hidden).toBe(false);
  expect(el('exLevels').style.display).toBe('none');            // no tier selector for grammar
  expect(el('exJp').innerHTML).toContain('gp-hit');             // the blank returned, marked
  expect(el('exJp').innerHTML).toContain('ようになった');
  expect(el('exEn').textContent).toBe('Became able to swim.');
  const before = Date.now();
  el('rightBtn').click();
  expect(state.store.cards[301].last).toBeGreaterThanOrEqual(before);   // the 法 auto-signal stamp
  expect(state.store.cards[301]).toMatchObject({ attempts: [1], right: 1, box: 1 });
});

test('grammar example rotates deterministically with the attempt count', () => {
  state.store.cards[301] = { attempts: [1], right: 1, wrong: 0, box: 1, due: 0 };   // 1 prior attempt → example 2
  ctx.deck = [GRAMMAR_CARD];
  startSession();
  expect(el('promptWord').innerHTML).toContain('<ruby>起<rt>お</rt></ruby>');
  expect(el('promptWord').innerHTML).not.toContain('ようになる。');   // example 2's blank hidden
});

test('the local sessions record is capped at 1000 (charts only — the durable log is server-side)', () => {
  state.store.sessions = Array.from({ length: 1000 }, (_, i) => ({ t: i, right: 1, tot: 1 }));
  ctx.deck = [CARD(1, '食べる', 'たべる')];
  startSession(); el('revealBtn').click(); el('rightBtn').click();
  expect(state.store.sessions).toHaveLength(1000);             // capped, oldest dropped
  expect(state.store.sessions[999]).toMatchObject({ right: 1, tot: 1, kind: 'srs' });
  expect(state.store.sessions[0].t).toBe(1);                   // slice(-1000) dropped t:0
});

/* ---- Conjugation mode (cfg.mode='conjugation') ----
   A PRODUCTION drill over the same session machinery: the prompt shows the dictionary form, the
   answer is an inflected form derived by the pure core/conjugation.js, and typed mode grades
   against the INFLECTED reading. Deck narrowing is deck.js's job (deck-render.test.js) — these
   pin the card faces, the typed target, the form rotation, and the pitch-mark suppression. */

const CONJ_CARD = (extra = {}) => CARD(1, '食べる', 'たべる', { type: 'ichidan', ...extra });

test('conjugation prompt: dictionary form + its reading + the asked form; answer is the inflection', () => {
  ctx.cfg.mode = 'conjugation';
  ctx.cfg.forms = ['te'];
  ctx.deck = [CONJ_CARD()];
  startSession();
  expect(el('promptLabel').textContent).toBe('Conjugate · て-form');
  expect(el('promptWord').textContent).toContain('食べる');
  expect(el('promptWord').querySelector('.conj-dict').textContent).toBe('たべる');   // reading rides along
  expect(el('promptTags').querySelector('.tag.conj').textContent).toBe('て形');
  expect(el('answerWord').textContent).toBe('食べて');
  expect(el('aRead').textContent).toBe('たべて');
  expect(el('aMean').textContent).toBe('て-form of 食べる — meaning-1');
  expect(el('veilLabelB').textContent).toBe('Form');
});

test('conjugation answer suppresses pitch marks — the accent describes the DICTIONARY form', () => {
  ctx.cfg.mode = 'conjugation';
  ctx.cfg.forms = ['past'];
  ctx.deck = [CONJ_CARD({ accent: 2 })];
  startSession();
  expect(el('aRead').innerHTML).toBe('たべた');            // plain text — no pitchHtml spans
  expect(el('aRead').querySelector('span')).toBe(null);
  expect(el('aAccent').hidden).toBe(true);                 // …and no "accent ［2］" chip
  // A normal card with the same accent still paints both.
  ctx.cfg.mode = 'meaning';
  ctx.deck = [CONJ_CARD({ accent: 2 })];
  startSession();
  expect(el('aAccent').hidden).toBe(false);
  expect(el('aRead').querySelector('span')).not.toBe(null);
});

test('conjugation typed mode grades the INFLECTED reading, not the dictionary reading', () => {
  ctx.cfg.mode = 'conjugation';
  ctx.cfg.forms = ['negative'];
  ctx.cfg.input = 'type';
  ctx.deck = [CONJ_CARD()];
  startSession();
  el('answerInput').value = 'たべる';                       // the dictionary reading — wrong here
  el('checkBtn').click();
  expect(el('typedVerdict').className).toContain('bad');

  ctx.deck = [CONJ_CARD()];
  startSession();
  el('answerInput').value = 'tabenai';                     // romaji folds to kana, then matches
  el('checkBtn').click();
  expect(el('typedVerdict').className).toContain('ok');
  expect(el('rightBtn').classList.contains('suggested')).toBe(true);
});

test('the asked form rotates with the attempt count, over the SELECTED forms only', () => {
  ctx.cfg.mode = 'conjugation';
  ctx.cfg.forms = ['te', 'past'];
  const ask = () => { ctx.deck = [CONJ_CARD()]; startSession(); return el('promptLabel').textContent; };
  state.store.cards[1] = { attempts: [], right: 0, wrong: 0, box: 0, due: 0 };
  expect(ask()).toContain('て-form');
  state.store.cards[1].attempts = [1];
  expect(ask()).toContain('Past');
  state.store.cards[1].attempts = [1, 1];
  expect(ask()).toContain('て-form');                       // wraps — never leaves the selection
});

test('a card that cannot inflect falls back to the normal face (defensive: cfg changed under us)', () => {
  ctx.cfg.mode = 'conjugation';
  ctx.deck = [CARD(9, '猫', 'ねこ', { cat: 'noun', type: '' })];
  startSession();
  expect(el('promptLabel').textContent).toBe('Read & recall · meaning + reading');
  expect(el('promptWord').querySelector('.conj-dict')).toBe(null);
  expect(el('promptTags').querySelector('.tag.conj')).toBe(null);
  expect(el('answerWord').textContent).toBe('猫');
});

test('an empty conjugation deck explains WHY it is empty, not the generic "no cards"', () => {
  const alert = vi.fn();
  vi.stubGlobal('alert', alert);
  ctx.cfg.mode = 'conjugation'; ctx.cfg.kind = 'free';
  ctx.deck = [];
  startSession();
  expect(alert.mock.calls[0][0]).toContain('can be conjugated');
  vi.unstubAllGlobals();
});
