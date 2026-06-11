// Pure-core tests for the standalone 日常日本語 study app.
//
// These used to concat verbs.js + examples.js + app.js and `new Function`-eval the
// result under a hand-built DOM stub (the app was classic scripts). Now the core is
// real ES modules, so we import them directly — which means a broken export/import
// fails the suite loudly. The pure core in src/core/* is DOM-free; the shared deck/
// progress lives in src/state.js, which the test seeds in beforeEach exactly as the
// app's rebuildData() does (built-ins + attachLevels), then mutates state.store per test.
import { test, expect, beforeEach } from 'vitest';
import { state, attachLevels } from '../src/state.js';
import { VERBS } from '../src/data/verbs.js';
import {
  passes, oneGroup, facetAll, facetMatch, scheduleCard, cardStat, isDue, dueCards,
  rollingAcc, isLeech, leeches, normKana, romajiToKana, reviewForecast, filterSummary,
  tokenFacet, deckLabel, ttsText, minnaBuiltinRank, applyMinnaOverlays, splitMora,
  pitchHtml, minnaSig, cardStamp, colorClass, CATS, exampleForLevel, availableTiers,
  JLPT_TIERS, BOX_DAYS,
  clampKeep, convItemKey, formatDuration, KEEP_DEFAULT,
  validClip, resolveClip, clipLabel, findTrimBounds,
  waveformPeaks, clampSpeed, COMPARE_SPEEDS,
} from '../src/core/index.js';

beforeEach(() => {
  // Rebuild the live deck like the app's rebuildData() does (built-in path: no custom
  // cards, empty overlays), then attach leveled examples + pitch accent + default cat.
  state.minnaStore = { notes: {}, lastLesson: null, overlays: {} };
  state.DATA = applyMinnaOverlays(VERBS.filter((v: any) => !v.skip));
  attachLevels();
  // Fresh, empty progress per test.
  state.store = { cards: {}, sessions: [], daily: {} };
});

// helper: count deck size for a partial config (fills facet defaults)
const cfg = (o: Partial<any>) =>
  ({ cat: [], type: [], trans: [], topic: [], status: [], jlpt: ['all'], rmin: 1, rmax: 999, ...o });
const count = (c: any) => state.DATA.filter((v: any) => passes(v, c)).length;

test('the dataset loads via real module imports', () => {
  expect(state.DATA.length).toBeGreaterThanOrEqual(100);
  expect(state.DATA.every((v: any) => v.jp && v.read && v.type)).toBe(true);
  // attachLevels() defaults a part-of-speech category onto every card.
  expect(state.DATA.every((v: any) => v.cat === 'verb')).toBe(true);
});

test('every built-in verb has all 5 leveled examples (well-formed)', () => {
  const builtin = state.DATA.filter((v: any) => !v.custom);
  expect(builtin.length).toBe(100);
  for (const v of builtin) {
    expect(v.levels).toBeTruthy();
    for (const t of JLPT_TIERS) {
      const e = v.levels[t];
      expect(Array.isArray(e) && e.length === 2).toBe(true);
      expect(typeof e[0] === 'string' && e[0].trim().length).toBeTruthy(); // jp
      expect(typeof e[1] === 'string' && e[1].trim().length).toBeTruthy(); // en
      const ro = (e[0].match(/<ruby>/g) || []).length;
      const rc = (e[0].match(/<\/ruby>/g) || []).length;
      expect(ro).toBe(rc);
    }
  }
});

test('exampleForLevel: exact tier, then nearest-tier fallback, then ex, then null', () => {
  const v = { rank: 1, jlpt: 'N5', levels: { N5: ['go5', 'e5'], N3: ['go3', 'e3'] }, ex: [['EX', 'exEN']] };
  expect(exampleForLevel(v, 'N5')).toEqual(['go5', 'e5']);
  expect(exampleForLevel(v, 'N3')).toEqual(['go3', 'e3']);
  expect(['go5', 'go3']).toContain(exampleForLevel(v, 'N4')![0]);
  expect(exampleForLevel(v, 'N1')).toEqual(['go3', 'e3']);
  const c = { rank: 200, levels: null, ex: [['CUSTOM', 'customEN']] };
  expect(exampleForLevel(c, 'N5')).toEqual(['CUSTOM', 'customEN']);
  expect(exampleForLevel({ rank: 201, levels: null, ex: [] }, 'N5')).toBeNull();
});

test('availableTiers lists only the tiers that have a sentence', () => {
  expect(availableTiers({ levels: { N5: ['a', 'b'], N2: ['c', 'd'] } })).toEqual(['N5', 'N2']);
  expect(availableTiers({ levels: null })).toEqual([]);
  expect(availableTiers(state.DATA.find((v: any) => v.rank === 1))).toEqual(['N5', 'N4', 'N3', 'N2', 'N1']);
});

test('normKana folds katakana→hiragana, strips spaces, unifies long marks', () => {
  expect(normKana('ハシル')).toBe('はしる');
  expect(normKana('  は し る ')).toBe('はしる');
  expect(normKana('タベル')).toBe('たべる');
  expect(normKana('はしる')).toBe('はしる');
  expect(normKana('ラーメン')).toBe('らーめん');
});

test('romajiToKana: Hepburn + wāpuro variants → hiragana', () => {
  expect(romajiToKana('taberu')).toBe('たべる');
  expect(romajiToKana('miru')).toBe('みる');
  expect(romajiToKana('kau')).toBe('かう');
  expect(romajiToKana('matsu')).toBe('まつ');
  expect(romajiToKana('shaberu')).toBe('しゃべる');
  expect(romajiToKana('hanasu')).toBe('はなす');
  expect(romajiToKana('oyogu')).toBe('およぐ');
  expect(romajiToKana('hanasi')).toBe(romajiToKana('hanashi'));
  expect(romajiToKana('tatu')).toBe('たつ');
  expect(romajiToKana('huku')).toBe('ふく');
});

test('romajiToKana: sokuon, ん, and kana pass-through', () => {
  expect(romajiToKana('kitte')).toBe('きって');
  expect(romajiToKana('matcha')).toBe('まっちゃ');
  expect(romajiToKana('hon')).toBe('ほん');
  expect(romajiToKana('onna')).toBe('おんな');
  expect(romajiToKana("shin'you")).toBe('しんよう');
  expect(romajiToKana('たべる')).toBe('たべる');
});

test('reviewForecast: buckets scheduled cards; overdue folds into slot 0', () => {
  const r0 = state.DATA[0].rank, r1 = state.DATA[1].rank, r2 = state.DATA[2].rank;
  const now = Date.now();
  state.store = {
    cards: {
      [r0]: { attempts: [1], right: 1, wrong: 0, box: 2, due: now - BOX_DAYS[1] },
      [r1]: { attempts: [1], right: 1, wrong: 0, box: 1, due: now + 1 * 86400000 + 1000 },
      [r2]: { attempts: [], right: 0, wrong: 0, box: 0, due: 0 },
    },
    sessions: [], daily: {},
  };
  const wk = reviewForecast('week');
  expect(wk.bars.length).toBe(7);
  expect(wk.bars[0].count).toBe(1);
  expect(wk.bars[0].now).toBe(true);
  expect(wk.bars[1].count).toBe(1);
  expect(wk.bars.reduce((s: number, b: any) => s + b.count, 0)).toBe(2);
  expect(reviewForecast('24h').bars.length).toBe(24);
  expect(reviewForecast('year').bars.length).toBe(12);
});

test('facetAll: empty or ["all"] is no-constraint; specific tokens constrain', () => {
  expect(facetAll([])).toBe(true);
  expect(facetAll(['all'])).toBe(true);
  expect(facetAll(undefined)).toBe(true);
  expect(facetAll(['godan'])).toBe(false);
});

test('tokenFacet routes tokens to the right facet', () => {
  expect(tokenFacet('godan')).toBe('type');
  expect(tokenFacet('ichidan')).toBe('type');
  expect(tokenFacet('trans')).toBe('trans');
  expect(tokenFacet('ti-pair')).toBe('trans');
  expect(tokenFacet('leech')).toBe('status');
  expect(tokenFacet('due')).toBe('status');
  expect(tokenFacet('motion')).toBe('topic');
  expect(tokenFacet('emotion')).toBe('topic');
  expect(tokenFacet('verb')).toBe('cat');
  expect(tokenFacet('adjective')).toBe('cat');
  expect(tokenFacet('noun')).toBe('cat');
});

test('passes: category facet ANDs in (built-ins are all verbs)', () => {
  expect(count(cfg({ cat: ['verb'] }))).toBe(state.DATA.length);
  expect(count(cfg({ cat: ['noun'] }))).toBe(0);
  expect(count(cfg({ cat: ['adjective', 'adverb'] }))).toBe(0);
  const godan = state.DATA.filter((v: any) => v.type === 'godan').length;
  expect(count(cfg({ cat: ['verb'], type: ['godan'] }))).toBe(godan);
  expect(count(cfg({ cat: ['noun'], type: ['godan'] }))).toBe(0);
});

test('oneGroup + cardStamp/colorClass cover non-verb categories', () => {
  expect(CATS).toContain('phrase');
  const noun = { cat: 'noun', type: '' };
  const adj = { cat: 'adjective', type: 'na-adj' };
  const verb = state.DATA.find((v: any) => v.type === 'godan')!;
  expect(oneGroup(noun, 'noun')).toBe(true);
  expect(oneGroup(noun, 'verb')).toBe(false);
  expect(oneGroup(verb, 'verb')).toBe(true);
  expect(cardStamp(verb)).toEqual({ label: 'GODAN', cls: 'godan' });
  expect(cardStamp(adj)).toEqual({ label: 'な-ADJ', cls: 'na-adj' });
  expect(cardStamp(noun)).toEqual({ label: 'NOUN', cls: 'noun' });
  expect(colorClass(verb)).toBe('godan');
  expect(colorClass(adj)).toBe('na-adj');
  expect(colorClass(noun)).toBe('noun');
});

test('passes: facets AND across, OR within (the headline behavior)', () => {
  const godan = state.DATA.filter((v: any) => v.type === 'godan').length;
  const motion = state.DATA.filter((v: any) => v.tags.includes('motion')).length;
  const godanAndMotion = state.DATA.filter((v: any) => v.type === 'godan' && v.tags.includes('motion')).length;
  expect(count(cfg({ type: ['godan'], topic: ['motion'] }))).toBe(godanAndMotion);
  expect(godanAndMotion).toBeLessThan(godan);
  expect(godanAndMotion).toBeLessThan(motion);
  const godanOrIchidan = state.DATA.filter((v: any) => v.type === 'godan' || v.type === 'ichidan').length;
  expect(count(cfg({ type: ['godan', 'ichidan'] }))).toBe(godanOrIchidan);
  expect(count(cfg({}))).toBe(state.DATA.length);
});

test('passes: jlpt facet and rank range AND on top', () => {
  const n5 = state.DATA.filter((v: any) => v.jlpt === 'N5').length;
  expect(count(cfg({ jlpt: ['N5'] }))).toBe(n5);
  expect(count(cfg({ rmin: 1, rmax: 25 }))).toBe(state.DATA.filter((v: any) => v.rank >= 1 && v.rank <= 25).length);
});

test('oneGroup: transitivity, class, and tag tokens', () => {
  const t = state.DATA.find((v: any) => v.trans === 't')!;
  const i = state.DATA.find((v: any) => v.trans === 'i')!;
  expect(oneGroup(t, 'trans')).toBe(true);
  expect(oneGroup(t, 'intrans')).toBe(false);
  expect(oneGroup(i, 'intrans')).toBe(true);
  const g = state.DATA.find((v: any) => v.type === 'godan')!;
  expect(oneGroup(g, 'godan')).toBe(true);
  expect(oneGroup(g, 'ichidan')).toBe(false);
});

test('tokenFacet routes Minna source tokens to the source facet', () => {
  expect(tokenFacet('minna')).toBe('source');
  expect(tokenFacet('italki')).toBe('source');
  expect(tokenFacet('mnn-l23')).toBe('source');
  expect(tokenFacet('mnn-l7')).toBe('source');
  expect(tokenFacet('money')).toBe('topic');
});

test('oneGroup: source tokens match the minna/italki flags + per-lesson tag', () => {
  const both = { minna: true, italki: true, tags: ['みんなの日本語', 'mnn-l23', 'iTalki'] };
  const minnaOnly = { minna: true, italki: false, tags: ['みんなの日本語', 'mnn-l24'] };
  const plain = { tags: [] };
  expect(oneGroup(both, 'minna')).toBe(true);
  expect(oneGroup(both, 'italki')).toBe(true);
  expect(oneGroup(both, 'mnn-l23')).toBe(true);
  expect(oneGroup(minnaOnly, 'minna')).toBe(true);
  expect(oneGroup(minnaOnly, 'italki')).toBe(false);
  expect(oneGroup(minnaOnly, 'mnn-l23')).toBe(false);
  expect(oneGroup(minnaOnly, 'mnn-l24')).toBe(true);
  expect(oneGroup(plain, 'minna')).toBe(false);
  expect(oneGroup(plain, 'italki')).toBe(false);
});

test('passes: source is an AND\'d facet (iTalki ∩ noun intersect)', () => {
  const deck = [
    { jlpt: 'N4', rank: 101, cat: 'verb', type: 'godan', trans: 't', minna: true, italki: true,  tags: ['みんなの日本語', 'mnn-l23', 'iTalki'] },
    { jlpt: 'N4', rank: 102, cat: 'noun', type: '',      trans: '',  minna: true, italki: true,  tags: ['みんなの日本語', 'mnn-l23', 'iTalki'] },
    { jlpt: 'N4', rank: 103, cat: 'noun', type: '',      trans: '',  minna: true, italki: false, tags: ['みんなの日本語', 'mnn-l24'] },
    { jlpt: 'N5', rank: 5,   cat: 'verb', type: 'godan', trans: 't', tags: ['motion'] },
  ];
  const hits = (o: any) => deck.filter((v) => passes(v, cfg(o))).length;
  expect(hits({ source: ['minna'] })).toBe(3);
  expect(hits({ source: ['italki'] })).toBe(2);
  expect(hits({ source: ['italki'], cat: ['noun'] })).toBe(1);
  expect(hits({ source: ['mnn-l24'] })).toBe(1);
  expect(hits({ source: ['minna'], cat: ['noun'] })).toBe(2);
  expect(hits({})).toBe(4);
});

test('attachLevels backfills a pitch accent onto every built-in verb (ACCENTS map)', () => {
  const builtins = state.DATA.filter((v: any) => v.rank <= 100);
  expect(builtins.length).toBe(100);
  expect(builtins.every((v: any) => typeof v.accent === 'number' && v.accent >= 0 && v.accent <= 12)).toBe(true);
  expect(typeof pitchHtml(builtins[0].read, builtins[0].accent)).toBe('string');
});

test('splitMora keeps small kana with the preceding mora', () => {
  expect(splitMora('はし')).toEqual(['は', 'し']);
  expect(splitMora('きょう')).toEqual(['きょ', 'う']);
  expect(splitMora('シャイン')).toEqual(['シャ', 'イ', 'ン']);
});

test('pitchHtml marks high morae + the drop (橋[2] ≠ 箸[1]), passthrough when no accent', () => {
  const hashi2 = pitchHtml('はし', 2);
  expect(hashi2).toContain('class="pitch"');
  expect(hashi2).toMatch(/<span class="pa">は<\/span>/);
  expect(hashi2).toMatch(/<span class="pa hi drop">し<\/span>/);
  const hashi1 = pitchHtml('はし', 1);
  expect(hashi1).toMatch(/<span class="pa hi drop">は<\/span>/);
  expect(hashi1).toMatch(/<span class="pa">し<\/span>/);
  const heiban = pitchHtml('はし', 0);
  expect(heiban).toMatch(/<span class="pa">は<\/span>/);
  expect(heiban).toMatch(/<span class="pa hi">し<\/span>/);
  expect(heiban).not.toContain('drop');
  expect(pitchHtml('はし', null)).toBe('はし');
  expect(pitchHtml('はし', undefined)).toBe('はし');
});

test('ttsText sends the kanji headword (accent-disambiguating), else the reading', () => {
  expect(ttsText({ jp: '橋', read: 'はし' })).toBe('橋');
  expect(ttsText({ jp: '聞く', read: 'きく' })).toBe('聞く');
  expect(ttsText({ jp: 'サイズ', read: 'サイズ' })).toBe('サイズ');
  expect(ttsText({ jp: 'ホームステイ', read: 'ホームステイ' })).toBe('ホームステイ');
  expect(ttsText({ jp: '角', read: 'かど', tts: 'かど' })).toBe('かど');
});

test("minnaSig reflects content (accent/mnem/tip/levels), not just tags", () => {
  const base = { tags: ['みんなの日本語', 'mnn-l23', 'iTalki'], italki: true };
  const bare = { ...base };
  const withContent = { ...base, accent: 2, mnem: 'hook', tip: 'trap', levels: { N5: ['a', 'b'] } };
  expect(minnaSig(bare)).not.toBe(minnaSig(withContent));
  expect(minnaSig(withContent)).not.toBe(minnaSig({ ...withContent, accent: 1 }));
  expect(minnaSig(withContent)).not.toBe(minnaSig({ ...withContent, mnem: 'other' }));
  expect(minnaSig(withContent)).not.toBe(minnaSig({ ...withContent, levels: { N5: ['a', 'c'] } }));
  expect(minnaSig(withContent)).toBe(minnaSig({ ...withContent }));
});

test('minnaBuiltinRank detects when a Minna word already exists as a built-in verb', () => {
  const kiku = state.DATA.find((v: any) => v.jp === '聞く');
  expect(kiku).toBeTruthy();
  expect(minnaBuiltinRank({ dict: '聞く' })).toBe(kiku!.rank);
  expect(minnaBuiltinRank({ dict: '出る' })).toBeGreaterThan(0);
  expect(minnaBuiltinRank({ dict: 'サイズ' })).toBe(null);
  expect(minnaBuiltinRank({ dict: '交差点' })).toBe(null);
});

test('applyMinnaOverlays merges Minna provenance onto the matching built-in (no duplicate)', () => {
  const kiku = state.DATA.find((v: any) => v.jp === '聞く')!;
  state.minnaStore = { notes: {}, lastLesson: 23, overlays: {
    [kiku.rank]: { tags: ['みんなの日本語', 'mnn-l23', 'iTalki'], italki: true, minnaLesson: 23, minnaKey: 'mnn:23:0', accent: 0 },
  } };
  const builtins = state.DATA.filter((v: any) => v.rank <= 100);
  const merged = applyMinnaOverlays(builtins);
  const k = merged.find((v: any) => v.jp === '聞く')!;
  expect(k.minna).toBe(true);
  expect(k.italki).toBe(true);
  expect(k.minnaKey).toBe('mnn:23:0');
  expect(k.accent).toBe(0);
  expect(k.tags).toContain('みんなの日本語');
  expect(k.tags).toContain('speaking');
  expect(merged.filter((v: any) => v.jp === '聞く').length).toBe(1);
  const other = state.DATA.find((v: any) => v.rank <= 100 && v.jp !== '聞く')!;
  expect(merged.find((v: any) => v.jp === other.jp)).toBe(other);
});

test("deckLabel + filterSummary surface the source facet (per-lesson → 'L23')", () => {
  expect(deckLabel('italki')).toBe('iTalki');
  expect(deckLabel('minna')).toBe('みんなの日本語');
  expect(deckLabel('mnn-l23')).toBe('L23');
  expect(deckLabel('mnn-l7')).toBe('L7');
  const parts = filterSummary({ cat: ['noun'], source: ['italki', 'mnn-l23'] });
  expect(parts).toContain('Noun');
  expect(parts).toContain('iTalki/L23');
});

test('scheduleCard: Leitner promote on correct (cap 5), reset to box 1 on miss', () => {
  const c: any = { box: 0, due: 0, attempts: [], right: 0, wrong: 0 };
  scheduleCard(c, true);
  expect(c.box).toBe(1);
  expect(c.due).toBeGreaterThan(Date.now());
  scheduleCard(c, true);
  expect(c.box).toBe(2);
  for (let k = 0; k < 10; k++) scheduleCard(c, true);
  expect(c.box).toBe(5);
  scheduleCard(c, false);
  expect(c.box).toBe(1);
});

test('isDue: new/box-0/overdue are due; future box is not', () => {
  const DAY = 86400000;
  state.store = {
    cards: {
      1: { attempts: [1], right: 1, wrong: 0, box: 3, due: Date.now() + 5 * DAY },
      2: { attempts: [1], right: 1, wrong: 0, box: 2, due: Date.now() - DAY },
      3: { attempts: [], right: 0, wrong: 0, box: 0, due: 0 },
    },
    sessions: [], daily: {},
  };
  expect(isDue(1)).toBe(false);
  expect(isDue(2)).toBe(true);
  expect(isDue(3)).toBe(true);
  expect(isDue(99999)).toBe(true);
});

test('rollingAcc: mean of last n attempts; null when never drilled', () => {
  state.store = { cards: { 1: { attempts: [1, 1, 0, 1], right: 3, wrong: 1, box: 2, due: 0 } }, sessions: [], daily: {} };
  expect(rollingAcc(1)).toBeCloseTo(0.75, 5);
  expect(rollingAcc(2)).toBeNull();
  state.store.cards[3] = { attempts: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1], right: 2, wrong: 8, box: 1, due: 0 };
  expect(rollingAcc(3)).toBeCloseTo(0.25, 5);
});

test('isLeech: <60% over the last ≥4 attempts', () => {
  state.store = {
    cards: {
      1: { attempts: [0, 0, 1, 0], right: 1, wrong: 3, box: 1, due: 0 },
      2: { attempts: [1, 0, 1], right: 2, wrong: 1, box: 1, due: 0 },
      3: { attempts: [1, 1, 0, 1], right: 3, wrong: 1, box: 2, due: 0 },
    },
    sessions: [], daily: {},
  };
  expect(isLeech(1)).toBe(true);
  expect(isLeech(2)).toBe(false);
  expect(isLeech(3)).toBe(false);
  expect(isLeech(99999)).toBe(false);
});

test('cardStat lazily creates + soft-migrates a record', () => {
  const c = cardStat(42);
  expect(c).toEqual({ attempts: [], right: 0, wrong: 0, box: 0, due: 0 });
  expect(state.store.cards[42]).toBe(c);
});

test('filterSummary: one part per non-empty facet (the AND\'d recap)', () => {
  const parts = filterSummary(cfg({ type: ['godan'], topic: ['motion'], rmin: 1, rmax: 25 }));
  expect(parts).toContain('Godan');
  expect(parts).toContain('Motion');
  expect(parts.some((p: string) => p.includes('rank 1'))).toBe(true);
  expect(filterSummary(cfg({}))).toEqual([]);
});

test('dueCards / leeches derive from store over the live DATA', () => {
  expect(dueCards().length).toBe(state.DATA.length);
  expect(leeches().length).toBe(0);
});

test('clampKeep clamps to [1,20] and defaults on garbage', () => {
  expect(clampKeep(3)).toBe(3);
  expect(clampKeep(0)).toBe(1);
  expect(clampKeep(99)).toBe(20);
  expect(clampKeep(4.7)).toBe(4);
  expect(clampKeep('abc')).toBe(KEEP_DEFAULT);
  expect(clampKeep(undefined)).toBe(KEEP_DEFAULT);
});

test('convItemKey builds a stable per-line key', () => {
  expect(convItemKey(23, 2)).toBe('mnn:23:conv:2');
  expect(convItemKey(24, 0)).toBe('mnn:24:conv:0');
});

test('formatDuration renders M:SS, empty on invalid', () => {
  expect(formatDuration(1500)).toBe('0:02');
  expect(formatDuration(65000)).toBe('1:05');
  expect(formatDuration(null)).toBe('');
  expect(formatDuration(-5)).toBe('');
});

test('validClip accepts [start<end] non-negative, rejects the rest', () => {
  expect(validClip([3, 7])).toEqual([3, 7]);
  expect(validClip([0, 2.5])).toEqual([0, 2.5]);
  expect(validClip([7, 3])).toBeNull();   // reversed
  expect(validClip([5, 5])).toBeNull();   // zero-length
  expect(validClip([-1, 3])).toBeNull();  // negative
  expect(validClip([3])).toBeNull();      // wrong arity
  expect(validClip(null)).toBeNull();
  expect(validClip(['a', 'b'] as any)).toBeNull();
});

test('resolveClip: synced store wins over the lesson-JSON clip', () => {
  expect(resolveClip([1, 2], [5, 8])).toEqual([5, 8]);   // store wins
  expect(resolveClip([1, 2], null)).toEqual([1, 2]);     // fall back to lesson JSON
  expect(resolveClip([1, 2], [9, 4])).toEqual([1, 2]);   // invalid store → lesson JSON
  expect(resolveClip(null, null)).toBeNull();
});

test('clipLabel formats a clip, empty when invalid', () => {
  expect(clipLabel([3, 7])).toBe('0:03–0:07');
  expect(clipLabel([65, 70])).toBe('1:05–1:10');
  expect(clipLabel(null)).toBe('');
  expect(clipLabel([5, 5])).toBe('');
});

test('findTrimBounds tightens to the sound region (silence·sound·silence)', () => {
  // 1 kHz "sample rate" so a 10 ms window = 10 samples; padMs:0 keeps the math exact.
  // minRunMs:0 disables the sustain gate so this 2-window blip exercises just the tighten math.
  const s = new Float32Array(80);              // [0..29]=silence, [30..49]=loud, [50..79]=silence
  for (let i = 30; i < 50; i++) s[i] = 0.5;
  const b = findTrimBounds(s, 1000, { windowMs: 10, padMs: 0, threshold: 0.1, minRunMs: 0 });
  expect(b).toEqual({ start: 30, end: 50 });
});

test('findTrimBounds pads around the sound and clamps to the buffer', () => {
  const s = new Float32Array(80);
  for (let i = 30; i < 50; i++) s[i] = 0.5;
  const b = findTrimBounds(s, 1000, { windowMs: 10, padMs: 10, threshold: 0.1, minRunMs: 0 }); // pad = 10 samples
  expect(b).toEqual({ start: 20, end: 60 });
});

test('findTrimBounds rejects edge click impulses (sustain gate) — only sustained speech anchors', () => {
  // A laptop trackpad click: a lone super-loud window at the very start AND end, with sustained
  // speech in the middle. Without the sustain gate the clicks anchor the edges and nothing
  // trims; with it, only the 20-window speech run counts, so both clicks fall outside [start,end).
  const s = new Float32Array(1000);
  s[5] = 0.9;                                   // click impulse, window 0 (samples 0–9)
  for (let i = 400; i < 600; i++) s[i] = 0.3;   // speech: windows 40–59
  s[995] = 0.9;                                 // click impulse, window 99 (samples 990–999)
  const b = findTrimBounds(s, 1000, { windowMs: 10, leadPadMs: 50, tailPadMs: 50 })!;
  expect(b.start).toBe(350);                    // speech onset 400 − 50 ms lead pad (NOT 0 — leading click ignored)
  expect(b.end).toBe(650);                      // speech offset 600 + 50 ms tail pad (NOT 1000 — trailing click ignored)
});

test('findTrimBounds robust peak: a lone loud click does not raise the threshold enough to clip quiet speech', () => {
  // A full loud click window at the start would, with a raw-max peak, push the adaptive
  // threshold (peak·ratio) above quiet speech and drop the whole take to null. The 95th-
  // percentile peak ignores the isolated click, so the quiet sustained speech is still found.
  const s = new Float32Array(1000);
  for (let i = 0; i < 10; i++) s[i] = 0.9;      // loud click burst, window 0
  for (let i = 300; i < 700; i++) s[i] = 0.03;  // quiet sustained speech: windows 30–69
  const b = findTrimBounds(s, 1000, { windowMs: 10, leadPadMs: 0, tailPadMs: 0 });
  expect(b).not.toBeNull();
  expect(b!.start).toBeGreaterThanOrEqual(300); // anchored on the quiet speech, click discounted
  expect(b!.end).toBe(700);
});

test('findTrimBounds returns null for all-silence (caller keeps original)', () => {
  expect(findTrimBounds(new Float32Array(100), 1000, { threshold: 0.1 })).toBeNull();
  expect(findTrimBounds(new Float32Array(0), 1000)).toBeNull();
});

test('findTrimBounds keeps a soft aspirated onset (below the vowel) via adaptive threshold + lead pad', () => {
  // sampleRate 1000 → 1 ms/sample. A breathy onset (0.02) at 150–199 precedes the loud
  // vowel body (0.5) at 200–399 — like the ひ of 引きます. The adaptive threshold keys on the
  // loud body, but an 80 ms lead pad (200-80=120) must reach back past the 150 onset so it
  // isn't clipped.
  const s = new Float32Array(600);
  for (let i = 150; i < 200; i++) s[i] = 0.02;
  for (let i = 200; i < 400; i++) s[i] = 0.5;
  const b = findTrimBounds(s, 1000, { windowMs: 10, leadPadMs: 80, tailPadMs: 40 })!;
  expect(b.start).toBeLessThanOrEqual(150);   // the soft onset is retained
  expect(b.end).toBeGreaterThanOrEqual(400);  // through the end of the body (+ tail pad)
});

test('waveformPeaks bins max-abs amplitude and normalizes to the clip peak', () => {
  // 4 quarters: |0.1|, |0.5|, silence, |0.25| → peaks [0.1,0.5,0,0.25] / 0.5 = [0.2,1,0,0.5].
  const s = new Float32Array(40);
  for (let i = 0; i < 10; i++) s[i] = -0.1;     // max-abs picks up the negative sign
  for (let i = 10; i < 20; i++) s[i] = 0.5;
  for (let i = 30; i < 40; i++) s[i] = 0.25;
  const p = waveformPeaks(s, 4);
  expect(p.length).toBe(4);
  expect(p[0]).toBeCloseTo(0.2, 5);
  expect(p[1]).toBeCloseTo(1, 5);
  expect(p[2]).toBe(0);
  expect(p[3]).toBeCloseTo(0.5, 5);
});

test('waveformPeaks: edge cases (empty / silent / bins>samples)', () => {
  expect(waveformPeaks(new Float32Array(0), 8).length).toBe(0);   // no samples
  expect(waveformPeaks(new Float32Array([0.5]), 0).length).toBe(0); // bins < 1
  const silent = waveformPeaks(new Float32Array(20), 5);           // flat → all-zero (peak 0, no divide)
  expect(silent.length).toBe(5);
  expect(Array.from(silent).every(v => v === 0)).toBe(true);
  const more = waveformPeaks(new Float32Array([0, 1, 0]), 6);      // bins > samples → ≥1 sample/bin, normalized
  expect(more.length).toBe(6);
  expect(Math.max(...more)).toBeCloseTo(1, 5);
});

test('clampSpeed snaps to the nearest allowed step, default 1×', () => {
  expect(COMPARE_SPEEDS).toEqual([0.5, 0.75, 1]);
  expect(clampSpeed(0.75)).toBe(0.75);
  expect(clampSpeed(0.6)).toBe(0.5);    // nearer 0.5 than 0.75
  expect(clampSpeed(0.7)).toBe(0.75);
  expect(clampSpeed(2)).toBe(1);        // above range → nearest (1)
  expect(clampSpeed('x' as any)).toBe(1);
  expect(clampSpeed(undefined as any)).toBe(1);
});
