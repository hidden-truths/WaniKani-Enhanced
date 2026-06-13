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
  tokenFacet, deckLabel, ttsText, rubyHtml, plainText, rubyToSegments, segmentsToRuby, segmentsToReading,
  overlayTokens,
  minnaBuiltinRank, applyMinnaOverlays, splitMora,
  cardGrammar, cardMatchesGrammar,
  pitchHtml, minnaSig, cardStamp, colorClass, CATS, exampleForLevel, availableTiers, sentencesToLevels,
  JLPT_TIERS, BOX_DAYS,
  clampKeep, convItemKey, formatDuration, KEEP_DEFAULT,
  validClip, resolveClip, clipLabel, findTrimBounds,
  waveformPeaks, clampSpeed, COMPARE_SPEEDS, rmsLevel, normGains,
  resolveVariant, parseAudioToken, contextPrefs, isSynthVoice, voiceProvider,
  DEFAULT_AUDIO_PREFS, AUDIO_VOICES, variantOrder, variantIndex, isKnownAudioToken, pruneAudioPrefs,
  hashStr, groupByScene, grammarTokens, todaysSet, emptyPractice, dayDiff, applyPractice,
  practiceStreak, donePhraseIds, sentenceToPhrase, phraseToSentence,
} from '../src/core/index.js';
import { SELFTALK, SELFTALK_SCENES, SELFTALK_GRAMMAR } from '../src/data/selftalk.js';
import { EXAMPLES } from '../src/data/examples.js';
import { GRAMMAR_CATALOG, grammarLabel, grammarJlpt, orderGrammar } from '../src/data/grammar.js';

beforeEach(() => {
  // Rebuild the live deck like the app's rebuildData() does (built-in path: no custom
  // cards, empty overlays), then attach leveled examples + pitch accent + default cat.
  // attachLevels() reads state.exampleLevels (Phase 2: hydrated from the store/cache at runtime);
  // seed it from the bundle here so the built-in cards get their levels, as in production.
  state.exampleLevels = EXAMPLES;
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

// The example sentences are now seeded into the server sentence store from this bundle, so the
// bundle is the SEED SOURCE — assert its integrity directly (not via attachLevels/v.levels, which
// after Phase 2 come from the store/cache, not the bundle).
test('the examples bundle has all 5 leveled examples per card (well-formed)', () => {
  const ranks = Object.keys(EXAMPLES);
  expect(ranks.length).toBe(100);
  for (const rank of ranks) {
    const tiers = (EXAMPLES as any)[rank];
    for (const t of JLPT_TIERS) {
      const e = tiers[t];
      expect(Array.isArray(e) && e.length === 2).toBe(true);
      expect(typeof e[0] === 'string' && e[0].trim().length).toBeTruthy(); // jp
      expect(typeof e[1] === 'string' && e[1].trim().length).toBeTruthy(); // en
      const ro = (e[0].match(/<ruby>/g) || []).length;
      const rc = (e[0].match(/<\/ruby>/g) || []).length;
      expect(ro).toBe(rc);
    }
  }
});

test('sentencesToLevels groups store sentences by owner_id + tier, reconstructing [jp,en]', () => {
  const sentences = [
    { furigana: rubyToSegments('<ruby>本<rt>ほん</rt></ruby>を<ruby>読<rt>よ</rt></ruby>む。'), translations: { en: 'read a book' }, link: { owner_type: 'card', owner_id: '1', tier: 'N5' } },
    { furigana: rubyToSegments('むずかしい。'), translations: { en: 'difficult' }, link: { owner_type: 'card', owner_id: '1', tier: 'N3' } },
    { furigana: rubyToSegments('いぬ。'), translations: { en: 'a dog' }, link: { owner_type: 'card', owner_id: '2', tier: 'N5' } },
  ];
  const levels = sentencesToLevels(sentences);
  // [jp, en, meta] — meta.furigana carries the structured segments (tokens/grammar absent here).
  expect(levels['1']).toEqual({
    N5: ['<ruby>本<rt>ほん</rt></ruby>を<ruby>読<rt>よ</rt></ruby>む。', 'read a book', { furigana: rubyToSegments('<ruby>本<rt>ほん</rt></ruby>を<ruby>読<rt>よ</rt></ruby>む。') }],
    N3: ['むずかしい。', 'difficult', { furigana: rubyToSegments('むずかしい。') }],
  });
  expect(levels['2']).toEqual({ N5: ['いぬ。', 'a dog', { furigana: rubyToSegments('いぬ。') }] });
});

test('sentencesToLevels carries annotation tokens + grammar into meta when present', () => {
  const fur = rubyToSegments('<ruby>本<rt>ほん</rt></ruby>を<ruby>読<rt>よ</rt></ruby>む。');
  const tokens = [{ i: 0, start: 0, end: 1, surface: '本', lemma: '本', pos: 'NOUN', tag: '', reading: 'ホン', dep: '', head: 1 }];
  const levels = sentencesToLevels([
    { furigana: fur, translations: { en: 'read a book' }, tags: { grammar: ['te-iru'] }, annotation: { tokens, bunsetsu: [], parser: 'p', parsedAt: 1 }, link: { owner_type: 'card', owner_id: '1', tier: 'N5' } },
  ]);
  expect(levels['1'].N5[2]).toEqual({ furigana: fur, tokens, grammar: ['te-iru'] });
});

test('cardGrammar unions a card\'s example-tier grammar; cardMatchesGrammar ORs the selection', () => {
  const v = { levels: {
    N5: ['x', 'x', { grammar: ['te-iru', 'volitional'] }],
    N4: ['y', 'y', { grammar: ['te-oku'] }],
    N3: ['z', 'z'],   // no meta → contributes nothing
  } };
  expect([...cardGrammar(v)].sort()).toEqual(['te-iru', 'te-oku', 'volitional']);
  expect(cardGrammar({}).size).toBe(0);                          // no levels → empty
  expect(cardMatchesGrammar(v, [])).toBe(true);                  // empty selection = no constraint
  expect(cardMatchesGrammar(v, ['te-oku'])).toBe(true);
  expect(cardMatchesGrammar(v, ['nakya'])).toBe(false);
  expect(cardMatchesGrammar(v, ['nakya', 'te-iru'])).toBe(true); // OR within the facet
});

test('grammar registry: catalog is the source of truth; SELFTALK_GRAMMAR labels derive from it', () => {
  expect(GRAMMAR_CATALOG.length).toBe(38);
  expect(grammarLabel('te-oku')).toBe('〜ておく');
  expect(grammarJlpt('te-oku')).toBe('N4');
  expect(grammarLabel('not-a-real-id')).toBe('not-a-real-id'); // unknown id falls back to itself
  // orderGrammar groups N5 before N4 (then catalog order within a level).
  expect(orderGrammar(['te-oku', 'te-iru'])).toEqual(['te-iru', 'te-oku']); // te-iru N5, te-oku N4
  // SELFTALK_GRAMMAR (the 6 teaching ids) now pulls its labels from the shared catalog — no drift.
  const byId = Object.fromEntries(SELFTALK_GRAMMAR.map((g: any) => [g.id, g.label]));
  expect(byId['te-oku']).toBe(grammarLabel('te-oku'));
  expect(byId['sou']).toBe(grammarLabel('sou'));
});

test('sentencesToLevels: a reused sentence (multiple links) lands under each rank/tier', () => {
  // The store returns one entry PER LINK, so a reused sentence arrives as two entries.
  const sentences = [
    { furigana: rubyToSegments('はしる。'), translations: { en: 'run' }, link: { owner_type: 'card', owner_id: '1', tier: 'N5' } },
    { furigana: rubyToSegments('はしる。'), translations: { en: 'run' }, link: { owner_type: 'card', owner_id: '2', tier: 'N3' } },
  ];
  const levels = sentencesToLevels(sentences);
  expect(levels['1']).toEqual({ N5: ['はしる。', 'run', { furigana: rubyToSegments('はしる。') }] });
  expect(levels['2']).toEqual({ N3: ['はしる。', 'run', { furigana: rubyToSegments('はしる。') }] });
});

test('sentencesToLevels skips entries missing owner_id / tier / furigana', () => {
  const sentences = [
    { furigana: rubyToSegments('いぬ。'), translations: { en: 'dog' }, link: { owner_type: 'selftalk' } },          // no owner_id/tier
    { furigana: null, translations: { en: 'x' }, link: { owner_type: 'card', owner_id: '3', tier: 'N5' } },          // no furigana
    { furigana: rubyToSegments('ねこ。'), translations: { en: 'cat' }, link: { owner_type: 'card', owner_id: '3', tier: 'N4' } },
  ];
  expect(sentencesToLevels(sentences)).toEqual({ '3': { N4: ['ねこ。', 'cat', { furigana: rubyToSegments('ねこ。') }] } });
});

// The strong test: round-trip the real bundle through the seed → store → adapter shape and assert
// it reconstructs EXAMPLES byte-for-byte. The seed stores text=plainText(jp) + furigana segments;
// the adapter rebuilds jp via segmentsToRuby. This pins the whole seed/read loop against live data.
test('seed round-trip: sentencesToLevels reconstructs the EXAMPLES bundle byte-for-byte', () => {
  const storeSentences: any[] = [];
  for (const [rank, tiers] of Object.entries(EXAMPLES as any)) {
    for (const [tier, pair] of Object.entries(tiers as Record<string, [string, string]>)) {
      const [jp, en] = pair;
      storeSentences.push({ furigana: rubyToSegments(jp), translations: { en }, link: { owner_type: 'card', owner_id: rank, tier } });
    }
  }
  const levels = sentencesToLevels(storeSentences);
  for (const [rank, tiers] of Object.entries(EXAMPLES as any)) {
    for (const [tier, pair] of Object.entries(tiers as Record<string, [string, string]>)) {
      // The [jp, en] reconstruction is what's pinned byte-for-byte; meta[2] is the additive overlay data.
      expect(levels[rank][tier].slice(0, 2)).toEqual(pair);
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

test('rubyHtml passes the ruby tag set through and escapes everything else', () => {
  // Furigana ruby survives so the data-furigana flip can toggle the <rt>.
  expect(rubyHtml('<ruby>橋<rt>はし</rt></ruby>を<ruby>渡<rt>わた</rt></ruby>る'))
    .toBe('<ruby>橋<rt>はし</rt></ruby>を<ruby>渡<rt>わた</rt></ruby>る');
  // Plain (ruby-less) text round-trips identically to escapeHtml.
  expect(rubyHtml('道を歩きます。')).toBe('道を歩きます。');
  // Non-ruby angle brackets / ampersands are escaped — a malformed entry can't inject markup.
  expect(rubyHtml('a & b <script>x</script>'))
    .toBe('a &amp; b &lt;script&gt;x&lt;/script&gt;');
  // Tags are normalized to lowercase; surrounding text still escaped.
  expect(rubyHtml('<RUBY>音<RT>おと</RT></RUBY> & <b>')).toBe('<ruby>音<rt>おと</rt></ruby> &amp; &lt;b&gt;');
});

test('plainText strips ruby back to the base sentence (TTS / key sync)', () => {
  expect(plainText('<ruby>橋<rt>はし</rt></ruby>を<ruby>渡<rt>わた</rt></ruby>ります。')).toBe('橋を渡ります。');
  expect(plainText('道を歩きます。')).toBe('道を歩きます。');
  // The inverse of rubyHtml's pass-through: rubyHtml then plainText returns the original.
  const s = '<ruby>音<rt>おと</rt></ruby>が 出ます。';
  expect(plainText(rubyHtml(s))).toBe('音が 出ます。');
  // Also strips the Phase-4 tap-overlay spans so speak/copy off a span-wrapped node stays the bare
  // sentence (the TTS key derived from span-free curated input is therefore unchanged).
  expect(plainText(overlayTokens(
    [{ t: '歯', r: 'は' }, { t: 'を' }, { t: '磨', r: 'みが' }, { t: 'く。' }],
    [{ i: 0, start: 0, end: 1, surface: '歯', lemma: '歯', pos: 'NOUN', tag: '', reading: '', dep: '', head: 0 },
     { i: 1, start: 1, end: 2, surface: 'を', lemma: 'を', pos: 'ADP', tag: '', reading: '', dep: '', head: 0 },
     { i: 2, start: 2, end: 4, surface: '磨く', lemma: '磨く', pos: 'VERB', tag: '', reading: '', dep: '', head: 0 }],
  ))).toBe('歯を磨く。');
});

test("minnaSig reflects content (accent/mnem/tip/levels), not just tags", () => {
  const base = { tags: ['みんなの日本語', 'mnn-l23', 'iTalki'], italki: true };
  const bare = { ...base };
  const withContent = { ...base, accent: 2, mnem: 'hook', tip: 'trap', levels: { N5: ['a', 'b'] }, audio: '/Audio/x.mp3' };
  expect(minnaSig(bare)).not.toBe(minnaSig(withContent));
  expect(minnaSig(withContent)).not.toBe(minnaSig({ ...withContent, accent: 1 }));
  expect(minnaSig(withContent)).not.toBe(minnaSig({ ...withContent, mnem: 'other' }));
  expect(minnaSig(withContent)).not.toBe(minnaSig({ ...withContent, levels: { N5: ['a', 'c'] } }));
  // The native-audio src is part of the signature, so a card gaining/losing it reads as "updated"
  // (older activated cards lack `audio` until re-activated → they surface in "Update N words").
  expect(minnaSig(withContent)).not.toBe(minnaSig({ ...withContent, audio: '/Audio/other.mp3' }));
  expect(minnaSig(withContent)).not.toBe(minnaSig({ ...withContent, audio: '' }));
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
    [kiku.rank]: { tags: ['みんなの日本語', 'mnn-l23', 'iTalki'], italki: true, minnaLesson: 23, minnaKey: 'mnn:23:0', accent: 0, audio: '/Audio/kiku.mp3' },
  } };
  const builtins = state.DATA.filter((v: any) => v.rank <= 100);
  const merged = applyMinnaOverlays(builtins);
  const k = merged.find((v: any) => v.jp === '聞く')!;
  expect(k.minna).toBe(true);
  expect(k.italki).toBe(true);
  expect(k.minnaKey).toBe('mnn:23:0');
  expect(k.accent).toBe(0);
  expect(k.audio).toBe('/Audio/kiku.mp3');   // native src merged → 'native' variant in Browse/reviews
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

test('rmsLevel is the root-mean-square amplitude (0 for empty)', () => {
  expect(rmsLevel(new Float32Array(0))).toBe(0);
  expect(rmsLevel(new Float32Array(100).fill(0.5))).toBeCloseTo(0.5, 6);   // constant 0.5
  expect(rmsLevel(new Float32Array([1, -1, 1, -1]))).toBeCloseTo(1, 6);    // sign-independent
});

test('normGains brings the louder clip down to the quieter, attenuate-only + floored', () => {
  expect(normGains(0.4, 0.2)).toEqual({ a: 0.5, b: 1 });   // a louder → 0.2/0.4; b quieter → 1
  expect(normGains(0.2, 0.4)).toEqual({ a: 1, b: 0.5 });
  expect(normGains(0.3, 0.3)).toEqual({ a: 1, b: 1 });
  const g = normGains(1.0, 0.01);                          // wild gap floored at 0.3 (no full mute)
  expect(g).toEqual({ a: 0.3, b: 1 });
  expect(normGains(0, 0.5)).toEqual({ a: 1, b: 1 });       // silent/missing side → no-op
  expect(normGains(0.5, null as any)).toEqual({ a: 1, b: 1 });
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

// ---------- audio-unify: per-context voice-priority resolver ----------

test('parseAudioToken distinguishes kinds from specific voices', () => {
  expect(parseAudioToken('kind:native')).toEqual({ type: 'kind', kind: 'native' });
  expect(parseAudioToken('native')).toEqual({ type: 'kind', kind: 'native' });     // bare alias
  expect(parseAudioToken('user')).toEqual({ type: 'kind', kind: 'user' });
  expect(parseAudioToken('tts')).toEqual({ type: 'kind', kind: 'tts' });
  expect(parseAudioToken('siri:female')).toEqual({ type: 'voice', voice: 'siri:female' });
  expect(parseAudioToken('google')).toEqual({ type: 'voice', voice: 'google' });
  expect(parseAudioToken('')).toBeNull();
});

test('isSynthVoice / voiceProvider classify providers', () => {
  expect(voiceProvider('siri:female')).toBe('siri');
  expect(isSynthVoice('siri:male')).toBe(true);
  expect(isSynthVoice('google')).toBe(true);
  expect(isSynthVoice('native')).toBe(false);
  expect(isSynthVoice('user')).toBe(false);
});

test('contextPrefs falls back to the per-context default when missing/empty', () => {
  expect(contextPrefs({}, 'minna')).toEqual(DEFAULT_AUDIO_PREFS.minna);
  expect(contextPrefs({ minna: [] }, 'minna')).toEqual(DEFAULT_AUDIO_PREFS.minna);
  expect(contextPrefs({ minna: ['google'] }, 'minna')).toEqual(['google']);
  expect(contextPrefs(null as any, 'reviews')).toEqual(DEFAULT_AUDIO_PREFS.reviews);
});

test('resolveVariant: a specific synth voice wins when tts is available', () => {
  // default reviews = ['siri:female','kind:tts'] → siri:female (server falls through if not generated)
  expect(resolveVariant('reviews', { tts: true, native: false, user: false }, {}))
    .toEqual({ kind: 'tts', voice: 'siri:female' });
});

test('resolveVariant: textbook defaults to native, else cascades to synth', () => {
  const av = (o: any) => ({ tts: true, native: false, user: false, ...o });
  // native present → native first (default minna = ['kind:native','siri:female',…])
  expect(resolveVariant('minna', av({ native: true }), {})).toEqual({ kind: 'native' });
  // no native → next default token is siri:female
  expect(resolveVariant('minna', av({ native: false }), {})).toEqual({ kind: 'tts', voice: 'siri:female' });
});

test('resolveVariant honors a user-ordered list (specific OR kind tokens)', () => {
  const prefs = { minna: ['kind:user', 'siri:male', 'kind:native'] };
  const av = { tts: true, native: true, user: true };
  expect(resolveVariant('minna', av, prefs)).toEqual({ kind: 'user' });          // user first
  expect(resolveVariant('minna', { ...av, user: false }, prefs)).toEqual({ kind: 'tts', voice: 'siri:male' });
  expect(resolveVariant('minna', { tts: false, native: true, user: false }, prefs)).toEqual({ kind: 'native' });
});

test('resolveVariant: kind:tts uses the first listed synth voice, else the default voice', () => {
  // "any synth" with no specific voice listed resolves to the DEFAULT voice ('default' → server's
  // smart Apple-first cascade), NOT an explicit 'google' pick (which would force the gtx voice).
  expect(resolveVariant('minna', { tts: true, native: false, user: false }, { minna: ['kind:tts'] }))
    .toEqual({ kind: 'tts', voice: 'default' });
  expect(resolveVariant('minna', { tts: true, native: false, user: false }, { minna: ['kind:native', 'kind:tts', 'siri:male'] }))
    .toEqual({ kind: 'tts', voice: 'siri:male' });   // native unavailable → kind:tts → first listed synth (siri:male)
});

test('resolveVariant: an explicitly-listed Google voice stays google (authoritative pick)', () => {
  // Explicit 'google' in the list must resolve to google (→ the server plays gtx), distinct from the
  // "any synth" default above. This is what makes the Settings "Google" voice actually play Google.
  expect(resolveVariant('browse', { tts: true, native: false, user: false }, { browse: ['google'] }))
    .toEqual({ kind: 'tts', voice: 'google' });
  expect(resolveVariant('browse', { tts: true, native: false, user: false }, { browse: ['siri:male', 'google'] }))
    .toEqual({ kind: 'tts', voice: 'siri:male' });   // first listed wins; google is honored only when reached
});

test('resolveVariant falls back to anything available, then null', () => {
  // prefs name only unavailable kinds → fall back to the one available kind
  expect(resolveVariant('minna', { tts: false, native: true, user: false }, { minna: ['kind:user'] }))
    .toEqual({ kind: 'native' });
  expect(resolveVariant('reviews', { tts: false, native: false, user: false }, {})).toBeNull();
});

test('resolveVariant: Browse "native first" plays native for a Minna card, synth when no native', () => {
  // The reported bug: setting Browse → native first did nothing for Minna cards (e.g. 交差点)
  // because the card offered no `native` variant outside the みんなの日本語 tab. With the deck card
  // now carrying its native src (speakWord passes { text, native }), a Minna card resolves to
  // native; a plain built-in (no native src) still falls through to the synth voice.
  const prefs = { browse: ['kind:native', 'kind:tts'] };
  expect(resolveVariant('browse', { tts: true, native: true, user: false }, prefs)).toEqual({ kind: 'native' });
  expect(resolveVariant('browse', { tts: true, native: false, user: false }, prefs)).toEqual({ kind: 'tts', voice: 'default' });
});

test('AUDIO_VOICES palette includes both Siri genders + Google', () => {
  expect(AUDIO_VOICES.map((v) => v.id)).toEqual(['siri:female', 'siri:male', 'google']);
});

// ---------- audio-unify ③: per-item voice cycle order ----------

test('variantOrder lists native, then each synth voice, then user — filtered by availability', () => {
  expect(variantOrder({ tts: true, native: true, user: true }).map((x) => x.kind === 'tts' ? x.voice : x.kind))
    .toEqual(['native', 'siri:female', 'siri:male', 'google', 'user']);
  // tts-only (a plain flashcard) still cycles the three synth voices
  expect(variantOrder({ tts: true, native: false, user: false }).map((x) => x.voice))
    .toEqual(['siri:female', 'siri:male', 'google']);
  // nothing available → empty (nothing to cycle)
  expect(variantOrder({ tts: false, native: false, user: false })).toEqual([]);
  // every entry carries a human label for the play-button hint
  expect(variantOrder({ tts: true }).every((x) => typeof x.label === 'string' && x.label)).toBe(true);
});

test('variantIndex finds a resolved variant by voice (synth) or kind (native/user), else -1', () => {
  const list = variantOrder({ tts: true, native: true, user: true });
  expect(variantIndex(list, { kind: 'tts', voice: 'siri:male' })).toBe(2);
  expect(variantIndex(list, { kind: 'native' })).toBe(0);
  expect(variantIndex(list, { kind: 'user' })).toBe(4);
  expect(variantIndex(list, { kind: 'tts', voice: 'nope' })).toBe(-1);
  expect(variantIndex(list, null)).toBe(-1);
});

// ---------- audio-unify ⑦: token hygiene ----------

test('isKnownAudioToken accepts kinds + palette voices, rejects unknowns', () => {
  ['kind:native', 'kind:tts', 'kind:user', 'native', 'user', 'siri:female', 'siri:male', 'google']
    .forEach((t) => expect(isKnownAudioToken(t)).toBe(true));
  ['forvo', 'kind:robot', 'siri:robot', '', null as any].forEach((t) => expect(isKnownAudioToken(t)).toBe(false));
});

test('pruneAudioPrefs drops unknown tokens and empties, keeps known order', () => {
  expect(pruneAudioPrefs({
    reviews: ['siri:female', 'forvo', 'kind:tts'],   // drop the unknown, keep order
    browse: ['nope', 'kind:robot'],                  // empties out → context dropped
    minna: ['kind:native', 'google'],
  })).toEqual({ reviews: ['siri:female', 'kind:tts'], minna: ['kind:native', 'google'] });
  expect(pruneAudioPrefs({})).toEqual({});
  expect(pruneAudioPrefs(null as any)).toBe(null);
});

// ----- Self-Talk (独り言) -----

test('SELFTALK dataset is well-formed (ids unique, scenes/grammar known, ruby balanced)', () => {
  expect(SELFTALK.length).toBeGreaterThan(20);
  const sceneIds = new Set(SELFTALK_SCENES.map((s: any) => s.id));
  const grammarIds = new Set(SELFTALK_GRAMMAR.map((g: any) => g.id));
  const ids = new Set<string>();
  for (const p of SELFTALK as any[]) {
    expect(p.id && p.jp && p.read && p.mean && p.scene).toBeTruthy();
    expect(ids.has(p.id)).toBe(false); ids.add(p.id);
    expect(sceneIds.has(p.scene)).toBe(true);
    expect(Array.isArray(p.grammar) && p.grammar.length).toBeTruthy();
    for (const g of p.grammar) expect(grammarIds.has(g)).toBe(true);
    // balanced ruby: one <rt>…</rt> per <ruby>…</ruby>
    const n = (s: string, re: RegExp) => (p.jp.match(re) || []).length;
    expect(n(p.jp, /<ruby>/g)).toBe(n(p.jp, /<\/ruby>/g));
    expect(n(p.jp, /<rt>/g)).toBe(n(p.jp, /<\/rt>/g));
    expect(n(p.jp, /<ruby>/g)).toBe(n(p.jp, /<rt>/g));
  }
});

// ---------- structured furigana (sentence store) ----------

test('rubyToSegments ↔ segmentsToRuby round-trips + reconstructs reading over ALL built-ins', () => {
  // This is the data-integrity gate the seed relies on: every built-in phrase must convert to
  // segments whose `t` rebuilds plainText(jp) byte-for-byte, whose ruby rebuilds jp exactly, and
  // whose derived reading equals the authored `read` (catches furigana drift in the data).
  for (const p of SELFTALK as any[]) {
    const segs = rubyToSegments(p.jp);
    expect(segs.map((s: any) => s.t).join('')).toBe(plainText(p.jp));
    expect(segmentsToRuby(segs)).toBe(p.jp);
    expect(segmentsToReading(segs)).toBe(p.read);
  }
});

test('rubyToSegments parses a mixed kanji/kana line into {t,r?} segments', () => {
  const jp = '<ruby>歯<rt>は</rt></ruby>を<ruby>磨<rt>みが</rt></ruby>いている。';
  expect(rubyToSegments(jp)).toEqual([{ t: '歯', r: 'は' }, { t: 'を' }, { t: '磨', r: 'みが' }, { t: 'いている。' }]);
  expect(segmentsToReading(rubyToSegments(jp))).toBe('はをみがいている。');
  expect(segmentsToRuby(rubyToSegments(jp))).toBe(jp);
});

test('rubyToSegments handles a no-kanji line as a single plain segment', () => {
  const jp = 'もっとリラックスしたい。';
  expect(rubyToSegments(jp)).toEqual([{ t: 'もっとリラックスしたい。' }]);
  expect(segmentsToReading(rubyToSegments(jp))).toBe('もっとリラックスしたい。');
  expect(segmentsToRuby(rubyToSegments(jp))).toBe(jp);
});

test('rubyToSegments on empty input is empty + round-trips', () => {
  expect(rubyToSegments('')).toEqual([]);
  expect(segmentsToRuby([])).toBe('');
  expect(segmentsToReading([])).toBe('');
});

test('hashStr is deterministic + varies by input', () => {
  expect(hashStr('a')).toBe(hashStr('a'));
  expect(hashStr('a')).not.toBe(hashStr('b'));
  expect(typeof hashStr('x')).toBe('number');
});

test('groupByScene orders by sceneOrder + skips empty scenes', () => {
  const ph = [
    { id: '1', scene: 'meals', grammar: ['tai'] },
    { id: '2', scene: 'morning', grammar: ['nakya'] },
    { id: '3', scene: 'morning', grammar: ['te-iru'] },
  ];
  const g = groupByScene(ph, ['morning', 'commute', 'meals']);
  expect(g.map((x: any) => x.scene)).toEqual(['morning', 'meals']);   // 'commute' empty → skipped
  expect(g[0].items.map((x: any) => x.id)).toEqual(['2', '3']);
  // no order → first-seen
  expect(groupByScene(ph).map((x: any) => x.scene)).toEqual(['meals', 'morning']);
});

test('grammarTokens returns present tokens in grammarOrder, extras after', () => {
  const ph = [{ grammar: ['sou', 'zzz'] }, { grammar: ['te-iru'] }];
  expect(grammarTokens(ph, ['te-iru', 'nakya', 'sou'])).toEqual(['te-iru', 'sou', 'zzz']);
});

test('todaysSet is deterministic per day, rotates across days, bounded + subset', () => {
  const ph = SELFTALK as any[];
  const a = todaysSet(ph, '2026-06-12', 8);
  expect(a).toEqual(todaysSet(ph, '2026-06-12', 8));   // stable within a day
  expect(a.length).toBe(8);
  const allIds = new Set(ph.map((p) => p.id));
  expect(a.every((id: string) => allIds.has(id))).toBe(true);
  // a different day (almost certainly) yields a different lead set
  expect(todaysSet(ph, '2026-06-13', 8)).not.toEqual(a);
  // n omitted → all ids
  expect(todaysSet(ph, '2026-06-12').length).toBe(ph.length);
});

test('applyPractice: first practice, same-day add (dedup), consecutive day, gap reset', () => {
  const p0 = emptyPractice();
  const p1 = applyPractice(p0, 'st-morning-1', '2026-06-12');
  expect(p1).toEqual({ lastDay: '2026-06-12', streak: 1, doneToday: ['st-morning-1'] });
  // same day, new phrase → added; streak unchanged
  const p2 = applyPractice(p1, 'st-morning-2', '2026-06-12');
  expect(p2.doneToday).toEqual(['st-morning-1', 'st-morning-2']);
  expect(p2.streak).toBe(1);
  // same day, repeat phrase → no duplicate
  expect(applyPractice(p2, 'st-morning-1', '2026-06-12').doneToday).toEqual(['st-morning-1', 'st-morning-2']);
  // next calendar day → streak +1, doneToday reset
  const p3 = applyPractice(p2, 'st-meals-1', '2026-06-13');
  expect(p3).toEqual({ lastDay: '2026-06-13', streak: 2, doneToday: ['st-meals-1'] });
  // skip a day → reset to 1
  const p4 = applyPractice(p3, 'st-meals-1', '2026-06-15');
  expect(p4.streak).toBe(1);
});

test('sentenceToPhrase maps a store sentence to the UI phrase shape', () => {
  const s = {
    id: 'st-morning-1',
    text: '歯を磨いている。',
    furigana: [{ t: '歯', r: 'は' }, { t: 'を' }, { t: '磨', r: 'みが' }, { t: 'いている。' }],
    translations: { en: "I'm brushing my teeth." },
    tags: { scene: 'morning', grammar: ['te-iru'] },
    link: { owner_type: 'selftalk' },
    custom: false,
  };
  expect(sentenceToPhrase(s)).toEqual({
    id: 'st-morning-1',
    jp: '<ruby>歯<rt>は</rt></ruby>を<ruby>磨<rt>みが</rt></ruby>いている。',
    read: 'はをみがいている。',
    mean: "I'm brushing my teeth.",
    scene: 'morning',
    grammar: ['te-iru'],
    custom: false,
    furigana: s.furigana,   // segments ride along for the tap overlay
    tokens: null,           // no annotation on this row
  });
});

test('sentenceToPhrase carries annotation tokens when present (tap overlay)', () => {
  const tokens = [{ i: 0, start: 0, end: 1, surface: '歯', lemma: '歯', pos: 'NOUN', tag: '', reading: 'ハ', dep: '', head: 1 }];
  const p = sentenceToPhrase({
    id: 'st-1', furigana: [{ t: '歯', r: 'は' }, { t: 'を' }], translations: { en: 'x' },
    tags: { grammar: ['te-iru'] }, annotation: { tokens, bunsetsu: [], parser: 'p', parsedAt: 1 }, custom: false,
  });
  expect(p.tokens).toEqual(tokens);
});

test('sentenceToPhrase tolerates missing translation/tags/furigana', () => {
  expect(sentenceToPhrase({ id: 'usr-x', furigana: null, translations: {}, tags: {}, custom: true })).toEqual({
    id: 'usr-x', jp: '', read: '', mean: '', scene: '', grammar: [], custom: true, furigana: [], tokens: null,
  });
});

test('phraseToSentence builds a store body from a ruby UI phrase', () => {
  const p = { id: 'usr-1', jp: '<ruby>歯<rt>は</rt></ruby>を<ruby>磨<rt>みが</rt></ruby>く。', read: 'はをみがく。', mean: 'brush', scene: 'morning', grammar: ['te-iru'] };
  expect(phraseToSentence(p)).toEqual({
    id: 'usr-1', text: '歯を磨く。',
    furigana: [{ t: '歯', r: 'は' }, { t: 'を' }, { t: '磨', r: 'みが' }, { t: 'く。' }],
    translations: { en: 'brush' }, tags: { scene: 'morning', grammar: ['te-iru'] }, link: { owner_type: 'selftalk' },
  });
});

test('phraseToSentence encodes a no-ruby line + read as one ruby segment so the kana survives', () => {
  const body = phraseToSentence({ id: 'usr-2', jp: '歯を磨く。', read: 'はをみがく。', mean: 'brush', scene: 'morning', grammar: [] });
  expect(body.text).toBe('歯を磨く。');
  expect(body.furigana).toEqual([{ t: '歯を磨く。', r: 'はをみがく。' }]);
  expect(sentenceToPhrase({ ...body, custom: true }).read).toBe('はをみがく。'); // derived reading survives
});

test('phraseToSentence ↔ sentenceToPhrase round-trips a fully-ruby phrase', () => {
  const p = { id: 'usr-3', jp: '<ruby>歯<rt>は</rt></ruby>を<ruby>磨<rt>みが</rt></ruby>く。', read: 'はをみがく。', mean: 'brush', scene: 'morning', grammar: ['te-iru'] };
  const body = phraseToSentence(p);
  // furigana segments ride along for the tap overlay; tokens are null (no annotation on this body).
  expect(sentenceToPhrase({ ...body, custom: true })).toEqual({
    id: 'usr-3', jp: '<ruby>歯<rt>は</rt></ruby>を<ruby>磨<rt>みが</rt></ruby>く。', read: 'はをみがく。', mean: 'brush', scene: 'morning', grammar: ['te-iru'], custom: true,
    furigana: body.furigana, tokens: null,
  });
});

test('practiceStreak: alive today/yesterday, broken after a gap; donePhraseIds today-only', () => {
  const p = { lastDay: '2026-06-12', streak: 5, doneToday: ['a', 'b'] };
  expect(practiceStreak(p, '2026-06-12')).toBe(5);   // today
  expect(practiceStreak(p, '2026-06-13')).toBe(5);   // yesterday → still alive (today not yet done)
  expect(practiceStreak(p, '2026-06-14')).toBe(0);   // a day missed → broken
  expect(practiceStreak(emptyPractice(), '2026-06-12')).toBe(0);
  expect([...donePhraseIds(p, '2026-06-12')]).toEqual(['a', 'b']);
  expect([...donePhraseIds(p, '2026-06-13')]).toEqual([]);   // not today → none
  expect(dayDiff('2026-06-12', '2026-06-13')).toBe(1);
  expect(dayDiff(null, '2026-06-13')).toBe(null);
});

// --- overlayTokens: tappable word spans over furigana ruby (Phase-4 commit 3b) ---
// Strip just the <span> tags to recover the underlying ruby render (spans are purely additive);
// for Japanese (no &<>"') escapeHtml is identity so this equals segmentsToRuby(segs).
const stripSpans = (h: string) => h.replace(/<span[^>]*>/g, '').replace(/<\/span>/g, '');
const plainOf = (h: string) => plainText(stripSpans(h));
const tok = (o: any) => ({ i: 0, surface: '', lemma: '', pos: 'NOUN', tag: '', reading: '', dep: '', head: 0, ...o });

test('overlayTokens wraps tappable tokens, keeps ruby inside a multi-char token, round-trips', () => {
  // 歯を磨く。  segs put ruby on each kanji; tokens are morphemes — 磨く spans the 磨 ruby + the kana く.
  const segs = [{ t: '歯', r: 'は' }, { t: 'を' }, { t: '磨', r: 'みが' }, { t: 'く。' }];
  const toks = [
    tok({ i: 0, start: 0, end: 1, surface: '歯', lemma: '歯', pos: 'NOUN', reading: 'ハ' }),
    tok({ i: 1, start: 1, end: 2, surface: 'を', lemma: 'を', pos: 'ADP', reading: 'ヲ' }),
    tok({ i: 2, start: 2, end: 4, surface: '磨く', lemma: '磨く', pos: 'VERB', reading: 'ミガク' }),
    tok({ i: 3, start: 4, end: 5, surface: '。', lemma: '。', pos: 'PUNCT' }),
  ];
  const out = overlayTokens(segs, toks);
  // spans are additive over the ruby: stripping them recovers the exact ruby render.
  expect(stripSpans(out)).toBe(segmentsToRuby(segs));
  // visible text round-trips to the plain canonical.
  expect(plainOf(out)).toBe('歯を磨く。');
  // three tappable tokens (。is PUNCT → skipped, rendered bare).
  expect((out.match(/class="extok"/g) || []).length).toBe(3);
  expect(out).not.toContain('data-surface="。"');
  expect(out).toContain('<span class="extok" data-i="2" data-lemma="磨く"');
  // the 磨く span contains BOTH the 磨 ruby and the trailing kana く.
  const m = out.match(/data-lemma="磨く"[^>]*>(.*?)<\/span>/s);
  expect(m && m[1]).toBe('<ruby>磨<rt>みが</rt></ruby>く');
});

test('overlayTokens is surrogate-safe across a non-BMP kanji (𠮟, U+20B9F)', () => {
  // 𠮟 is a surrogate pair: "𠮟".length === 2, so the token/segment offsets span 2 units.
  const segs = [{ t: '𠮟', r: 'しか' }, { t: 'る' }];
  const toks = [
    tok({ i: 0, start: 0, end: 2, surface: '𠮟', lemma: '𠮟る', pos: 'VERB', reading: 'シカ' }),
    tok({ i: 1, start: 2, end: 3, surface: 'る', lemma: 'る', pos: 'AUX' }),
  ];
  const out = overlayTokens(segs, toks);
  expect(stripSpans(out)).toBe(segmentsToRuby(segs));
  expect(plainOf(out)).toBe('𠮟る');           // 𠮟 intact (length 3 total), never torn mid-pair
  expect(out).toContain('<ruby>𠮟<rt>しか</rt></ruby>');
});

test('overlayTokens: empty tokens → plain escaped ruby (no spans); a gap stays bare', () => {
  const segs = [{ t: '歯', r: 'は' }, { t: 'をみがく。' }];
  const noTok = overlayTokens(segs, []);
  expect(noTok).not.toContain('extok');
  expect(plainOf(noTok)).toBe('歯をみがく。');
  // a dropped-whitespace gap (offset 1 covered by no token) is emitted bare, between spans.
  const gapSegs = [{ t: 'A B' }];
  const gapToks = [
    tok({ i: 0, start: 0, end: 1, surface: 'A', lemma: 'A' }),
    tok({ i: 1, start: 2, end: 3, surface: 'B', lemma: 'B' }),
  ];
  const gapOut = overlayTokens(gapSegs, gapToks);
  expect((gapOut.match(/class="extok"/g) || []).length).toBe(2);
  expect(plainOf(gapOut)).toBe('A B');         // the space round-trips, no infinite loop
});

test('overlayTokens escapes content + attributes (safe on the user-authored path)', () => {
  const segs = [{ t: 'a<b' }];
  const toks = [tok({ i: 0, start: 0, end: 3, surface: 'a<b', lemma: 'a<b', pos: 'NOUN' })];
  const out = overlayTokens(segs, toks);
  expect(out).toContain('a&lt;b');             // escaped in both the data-lemma attr and the content
  expect(out).not.toContain('a<b');            // no raw, unescaped angle bracket from the data
});
