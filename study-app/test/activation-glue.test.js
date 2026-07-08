// Activation-glue tests for the two vocab→deck paths that had ZERO coverage:
// grammar/activate.js `activateGrammarPoints` and songs/progress.js `activateSongWords`
// (driven through its public entry points addOneWord/addAllNew). activateWkVocab and the
// 合格 gap-fill add path are already covered (wanikani-render.test.js / jlpt-render.test.js);
// this closes the uneven gap in exactly the code refactor-activate-append-helper will touch.
//
// Modeled on wanikani-render.test.js's activation block: a real Map-backed localStorage +
// the real persistence/custom.js + the real pure core builders, with the rebuild fan-out
// (rebuildData/refreshAfterVerbChange) and — for songs — the package render + the two extra
// progress stores mocked out. The load-bearing assertion is the CONTRAST: a song card is
// stamped with `added` (it counts toward the 語 quota), a grammar card deliberately is NOT
// (grammar is paced separately by grammarPerWeek — see weeklyAddPace's v.grammar skip).
import { test, expect, beforeEach, vi } from 'vitest';

// custom-cards' rebuild fan-out drags deck/browse/stats + their eval-time localStorage reads —
// inert stubs, exactly as wanikani-render.test.js treats it.
vi.mock('../src/features/custom-cards.js', () => ({ rebuildData: vi.fn(), refreshAfterVerbChange: vi.fn() }));
// songs/progress imports render from the package barrel (the whole songs graph — engine, audio,
// YouTube, …) and writes two progress blobs; none of that is what an activation test exercises.
vi.mock('../src/features/songs/index.js', () => ({ render: vi.fn() }));
vi.mock('../src/persistence/songs.js', () => ({ saveSongs: vi.fn(), loadSongs: vi.fn() }));
vi.mock('../src/persistence/selftalk.js', () => ({ saveSelftalk: vi.fn(), loadSelftalk: vi.fn() }));
// songs/library.js pulls api from cloud-core at eval time; the activation path never fetches.
vi.mock('../src/features/cloud-core.js', () => ({ api: async () => ({}), account: null, setSyncStatus: () => {} }));

// persistence/custom.js reads localStorage at call time — a working Map-backed fake.
const bag = new Map();
vi.stubGlobal('localStorage', {
  getItem: (k) => (bag.has(k) ? bag.get(k) : null),
  setItem: (k, v) => bag.set(k, String(v)),
  removeItem: (k) => bag.delete(k),
  clear: () => bag.clear(),
});

import { state } from '../src/state.js';
import { activateGrammarPoints } from '../src/features/grammar/activate.js';
import { addOneWord, addAllNew } from '../src/features/songs/progress.js';
import { S } from '../src/features/songs/state.js';
import { loadCustom } from '../src/persistence/custom.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

beforeEach(() => {
  bag.clear();
  state.DATA = [];
  state.store = { cards: {} };
  state.songsStore = { progress: {} };
  state.selftalkStore = { practice: {} };
});

/* ---- grammar activation (activateGrammarPoints) -------------------------------- */

const gp = (id, o = {}) => ({ id, label: o.label || `〜${id}`, read: o.read || id, mean: o.mean || `means ${id}`, jlpt: o.jlpt || 'N3' });

test('activateGrammarPoints appends a tagged grammar card on a monotonic seq rank', () => {
  expect(activateGrammarPoints([gp('wake-da'), gp('hazu-da')])).toBe(2);
  const cards = loadCustom().verbs;
  expect(cards.length).toBe(2);
  const c = cards[0];
  expect(c.cat).toBe('grammar');
  expect(c.grammar).toBe(true);
  expect(c.grammarId).toBe('wake-da');
  expect(c.tags).toContain('文法');
  expect(c.rank).toBeGreaterThan(100);            // custom seq range, never reused
  expect(cards[1].rank).toBeGreaterThan(c.rank);  // monotonic
});

test('a grammar card is NOT stamped with `added` — it is paced separately, not by the 語 quota', () => {
  activateGrammarPoints([gp('to-iu-koto')]);
  const c = loadCustom().verbs[0];
  expect('added' in c).toBe(false);   // load-bearing: weeklyAddPace skips v.grammar; a stamp would inflate the word quota
});

test('activateGrammarPoints is idempotent by grammarId — a re-click adds nothing', () => {
  expect(activateGrammarPoints([gp('nagara')])).toBe(1);
  // mirror rebuildData (mocked): the deck now carries the activated grammar card
  state.DATA = [...loadCustom().verbs];
  expect(activateGrammarPoints([gp('nagara')])).toBe(0);        // already in the deck by id
  expect(activateGrammarPoints([gp('nagara'), gp('bakari')])).toBe(1);  // only the new one lands
  expect(loadCustom().verbs.length).toBe(2);
});

test('activateGrammarPoints no-ops on an empty / all-duplicate list without touching storage', () => {
  expect(activateGrammarPoints([])).toBe(0);
  expect(activateGrammarPoints(null)).toBe(0);
  expect(loadCustom().verbs.length).toBe(0);
});

/* ---- songs activation (activateSongWords via addAllNew / addOneWord) ----------- */

const tok = (lemma, o = {}) => ({ lemma, pos: o.pos || 'NOUN', reading: o.reading || lemma, jlpt: o.jlpt || 'N4', gloss: o.gloss || `gloss ${lemma}` });
const openSong = (tokens) => { S.openSong = { id: 'usr-42', title: 'テスト曲', lines: [{ tokens }] }; };

test('addAllNew activates every mined word as a tagged Source:歌 card, stamped with `added`', () => {
  openSong([tok('走る', { pos: 'VERB', reading: 'はしる' }), tok('君', { reading: 'きみ' })]);
  addAllNew();
  const cards = loadCustom().verbs;
  expect(cards.length).toBe(2);
  const c = cards[0];
  expect(c.song).toBe(true);
  expect(c.songId).toBe('usr-42');
  expect(c.songKey).toBe('song-usr-42-走る');
  expect(c.tags).toEqual(expect.arrayContaining(['歌', 'song-usr-42']));
  expect(c.rank).toBeGreaterThan(100);
  expect(cards[1].rank).toBeGreaterThan(c.rank);       // monotonic seq
  expect(c.added).toMatch(DAY);                        // contrast with grammar: song words DO count toward the quota
});

test('addAllNew is idempotent — re-running skips words already activated (songKey dedup)', () => {
  openSong([tok('走る', { pos: 'VERB' }), tok('君')]);
  addAllNew();
  expect(loadCustom().verbs.length).toBe(2);
  addAllNew();                                          // same song, no state.DATA mirror → exercises activateSongWords' own dedup
  expect(loadCustom().verbs.length).toBe(2);            // the persisted songKeys skip both
});

test('addAllNew skips a word already KNOWN in the deck (box>0) and one already in the deck', () => {
  openSong([tok('走る', { pos: 'VERB' }), tok('君')]);
  state.DATA = [{ rank: 5, jp: '走る', read: 'はしる' }];
  state.store = { cards: { 5: { box: 2 } } };            // 走る is a studied deck card → known
  addAllNew();
  const cards = loadCustom().verbs;
  expect(cards.length).toBe(1);
  expect(cards[0].jp).toBe('君');                        // only the genuinely-new word landed
});

test('addOneWord activates a single mined word by lemma', () => {
  openSong([tok('走る', { pos: 'VERB' }), tok('君')]);
  addOneWord('君');
  const cards = loadCustom().verbs;
  expect(cards.length).toBe(1);
  expect(cards[0].jp).toBe('君');
  addOneWord('存在しない');                              // not a mined word → no-op
  expect(loadCustom().verbs.length).toBe(1);
});
