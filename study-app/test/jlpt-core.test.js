// Pure-core tests for the 合格 JLPT lens (src/core/jlpt.js) — the word-list map +
// lookups, exam countdown, deck/WaniKani coverage, and the daily-checklist record ops
// (normalize/merge/heat). All time-dependent functions take injected nowMs/dayKey
// (project convention).
import { test, expect } from 'vitest';
import {
  JLPT_LEVEL_ORDER, buildJlptMap, jlptLookup, jlptLevelTotal, examCountdown,
  deckJlptCoverage, wkJlptCoverage, normalizeJlpt, mergeJlpt, shiftDay, checklistHeat,
  JLPT_DAYS_KEEP,
  DEFAULT_TARGETS, jlptTargets, deckWordSet, wkVocabIndex, jlptGap, selectGapBatch,
  buildJlptCard, weeklyAddPace, pacePlan, PACE_BUFFER_DAYS,
  mockTotal, normalizeMock, normalizeMocks, mockVerdict, mockTrend, JLPT_MOCKS_KEEP,
} from '../src/core/jlpt.js';
import { buildWkCard } from '../src/core/wanikani.js';

const NOW = Date.parse('2026-07-01T12:00:00');

/* ---- word-list map ---------------------------------------------------------- */

const MAP = buildJlptMap({ N5: '食べる,ああ', N4: '経済,あげる', N3: 'あいにく,一方,あらゆる', N2: '', N1: 'あくどい,食べる' });

test('buildJlptMap parses the compact shape; a duplicate keeps the EASIER level', () => {
  expect(MAP.get('経済')).toBe('N4');
  expect(MAP.get('食べる')).toBe('N5');   // listed at N5 and N1 → N5 wins (easy→hard order)
  expect(MAP.size).toBe(8);               // 9 listed − 1 dup collapsed
  expect(jlptLevelTotal(MAP, 'N3')).toBe(3);
  expect(jlptLevelTotal(MAP, 'N2')).toBe(0);
});

test('jlptLookup matches headword first, then reading, else empty', () => {
  expect(jlptLookup(MAP, '一方', 'いっぽう')).toBe('N3');
  expect(jlptLookup(MAP, '生憎', 'あいにく')).toBe('N3');   // kanji form unlisted → kana reading hits
  expect(jlptLookup(MAP, '未知語', 'みちご')).toBe('');
  expect(jlptLookup(null, '一方', '')).toBe('');
});

/* ---- countdown ---------------------------------------------------------------- */

test('examCountdown counts calendar days (weeks + rest), flags past, rejects junk', () => {
  expect(examCountdown('2026-12-06', NOW)).toEqual({ days: 158, weeks: 22, restDays: 4, past: false });
  expect(examCountdown('2026-07-01', NOW).days).toBe(0);
  expect(examCountdown('2026-06-30', NOW).past).toBe(true);
  expect(examCountdown('soon', NOW)).toBe(null);
  expect(examCountdown('', NOW)).toBe(null);
});

/* ---- coverage -------------------------------------------------------------------- */

test('deckJlptCoverage counts distinct list words in the deck + the box-4+ solid slice', () => {
  const data = [
    { rank: 1, jp: 'あいにく', read: 'あいにく' },
    { rank: 2, jp: '一方', read: 'いっぽう' },
    { rank: 3, jp: '一方', read: 'いっぽう' },   // second card on the same word — counted ONCE
    { rank: 4, jp: '食べる', read: 'たべる' },   // N5, not N3
  ];
  const cards = { 1: { box: 5 }, 2: { box: 2 } };
  expect(deckJlptCoverage(MAP, 'N3', data, cards)).toEqual({ total: 3, inDeck: 2, solid: 1 });
  expect(deckJlptCoverage(MAP, 'N5', data, cards)).toEqual({ total: 2, inDeck: 1, solid: 0 });
  expect(deckJlptCoverage(MAP, 'N3', [], {})).toEqual({ total: 3, inDeck: 0, solid: 0 });
});

test('wkJlptCoverage matches WK vocabulary by chars: started + guru slices', () => {
  const subjects = new Map([
    [1, { id: 1, type: 'vocabulary', chars: 'あいにく', hidden: false }],
    [2, { id: 2, type: 'vocabulary', chars: '一方', hidden: false }],
    [3, { id: 3, type: 'vocabulary', chars: 'あらゆる', hidden: false }],
    [4, { id: 4, type: 'kanji', chars: '一', hidden: false }],          // kanji never counted
  ]);
  const assignments = new Map([
    [1, { subjectId: 1, stage: 6, startedAt: 1, hidden: false }],       // guru+
    [2, { subjectId: 2, stage: 2, startedAt: 1, hidden: false }],       // apprentice
    // subject 3 unlocked-but-no-assignment → on WK, not started
  ]);
  expect(wkJlptCoverage(MAP, 'N3', subjects, assignments)).toEqual({ total: 3, onWk: 3, started: 2, guru: 1 });
});

test('buildWkCard stamps the looked-up jlpt level (and defaults to empty)', () => {
  const s = { id: 9, chars: '一方', level: 21, pos: ['noun'], meanings: [{ m: 'one side', primary: true }], readings: [{ r: 'いっぽう', primary: true }], contextSentences: [] };
  expect(buildWkCard(s, 101, 'N3').jlpt).toBe('N3');
  expect(buildWkCard(s, 101).jlpt).toBe('');
});

/* ---- checklist record ---------------------------------------------------------------- */

test('normalizeJlpt tolerates junk, validates level/date, folds day flags, prunes old days', () => {
  const today = '2026-07-01';
  expect(normalizeJlpt(null, today, { level: 'N3', examDate: '2026-12-06' }))
    .toEqual({ level: 'N3', examDate: '2026-12-06', days: {} });
  const old = shiftDay(today, -(JLPT_DAYS_KEEP + 1));
  const o = normalizeJlpt({
    level: 'N9', examDate: 'someday',
    days: { '2026-06-30': { due: 1, speak: 0, junk: true }, [old]: { due: 1 }, 'not-a-day': { due: 1 } },
  }, today, { level: 'N3', examDate: '2026-12-06' });
  expect(o.level).toBe('N3');                    // invalid level → default
  expect(o.examDate).toBe('2026-12-06');         // invalid date → default
  expect(o.days).toEqual({ '2026-06-30': { due: 1, junk: 1 } });   // falsy flags dropped, truthy folded to 1; old + malformed days pruned
  expect(normalizeJlpt({ level: 'N2', examDate: '2027-07-04', days: {} }, today).level).toBe('N2');
});

test('mergeJlpt unions day records both ways; scalars keep local', () => {
  const local = { level: 'N3', examDate: '2026-12-06', days: { d1: { a: 1 }, d2: { b: 1 } } };
  const server = { level: 'N2', examDate: '2027-07-04', days: { d1: { c: 1 }, d3: { d: 1 } } };
  expect(mergeJlpt(local, server)).toEqual({
    level: 'N3', examDate: '2026-12-06',
    days: { d1: { a: 1, c: 1 }, d2: { b: 1 }, d3: { d: 1 } },
  });
  expect(mergeJlpt(null, server).level).toBe('N2');   // nothing local → server survives
});

test('shiftDay does local-date arithmetic across month/year bounds', () => {
  expect(shiftDay('2026-07-01', -1)).toBe('2026-06-30');
  expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
  expect(shiftDay('2026-07-01', 7)).toBe('2026-07-08');
  expect(shiftDay('garbage', 3)).toBe('garbage');
});

test('checklistHeat returns oldest→today with done capped at taskCount', () => {
  const days = { '2026-07-01': { a: 1, b: 1, c: 1, zombie: 1, extra: 1 }, '2026-06-29': { a: 1 } };
  const heat = checklistHeat(days, '2026-07-01', 3, 4);
  expect(heat.map((h) => h.day)).toEqual(['2026-06-29', '2026-06-30', '2026-07-01']);
  expect(heat.map((h) => h.done)).toEqual([1, 0, 4]);   // 5 recorded flags cap at the 4 live tasks
  expect(heat[2].frac).toBe(1);
});

test('JLPT_LEVEL_ORDER runs easy → hard', () => {
  expect(JLPT_LEVEL_ORDER).toEqual(['N5', 'N4', 'N3', 'N2', 'N1']);
});

/* ---- pacing coach + gap-fill --------------------------------------------------- */

test('jlptTargets applies defaults at read; stored targets override per field', () => {
  expect(jlptTargets(null)).toEqual(DEFAULT_TARGETS);
  expect(jlptTargets({ targets: { wordsPerDay: 20 } })).toEqual({ wordsPerDay: 20, grammarPerWeek: DEFAULT_TARGETS.grammarPerWeek });
});

test('normalizeJlpt clamps targets to sane ints and OMITS the key when empty', () => {
  const t = normalizeJlpt({ targets: { wordsPerDay: '15.6', grammarPerWeek: 500, junk: 3 } }, '2026-07-01');
  expect(t.targets).toEqual({ wordsPerDay: 16 });          // rounded; 500 out of range; junk dropped
  const bare = normalizeJlpt({ level: 'N3' }, '2026-07-01');
  expect('targets' in bare).toBe(false);                   // pre-targets blob round-trips shape-identical
  expect('targets' in normalizeJlpt({ targets: { wordsPerDay: 0 } }, '2026-07-01')).toBe(false);
});

test('mergeJlpt unions targets per field, local wins', () => {
  const m = mergeJlpt({ targets: { wordsPerDay: 8 } }, { targets: { wordsPerDay: 15, grammarPerWeek: 7 } });
  expect(m.targets).toEqual({ wordsPerDay: 8, grammarPerWeek: 7 });
  expect('targets' in mergeJlpt({ days: {} }, { days: {} })).toBe(false);
});

test('normalizeJlpt carries the mcq trail, omits it when empty, and EXEMPTS it from the day pruning', () => {
  const today = '2026-07-08';
  const o = normalizeJlpt({
    mcq: { 'sei-de': { right: 2, wrong: 1, last: '2020-01-01' }, 'kuse-ni': { right: 0, wrong: 0 } },
    days: { '2020-01-01': { deck: 1 } },   // way past the 60-day cutoff
  }, today);
  expect(o.days).toEqual({});                               // pruned…
  expect(o.mcq).toEqual({ 'sei-de': { right: 2, wrong: 1, last: '2020-01-01' } });  // …the trail is not
  expect('mcq' in normalizeJlpt({ level: 'N3' }, today)).toBe(false);  // pre-trail blob round-trips
  expect('mcq' in normalizeJlpt({ mcq: {} }, today)).toBe(false);
});

test('mergeJlpt reconciles the mcq trail by per-point max, and omits the key when neither side drilled', () => {
  const m = mergeJlpt({ mcq: { 'sei-de': { right: 5, wrong: 1 } } }, { mcq: { 'sei-de': { right: 3, wrong: 4 } } });
  expect(m.mcq).toEqual({ 'sei-de': { right: 5, wrong: 4 } });   // max per field, NOT 8/5
  expect('mcq' in mergeJlpt({ days: {} }, { days: {} })).toBe(false);
});

test('deckWordSet collects headwords AND readings', () => {
  const s = deckWordSet([{ jp: '一方', read: 'いっぽう' }, { jp: 'ある' }]);
  expect(s.has('一方') && s.has('いっぽう') && s.has('ある')).toBe(true);
});

test('wkVocabIndex maps visible vocabulary chars to stage/started/wkLevel', () => {
  const subjects = new Map([
    [1, { id: 1, type: 'vocabulary', chars: '一方', level: 14 }],
    [2, { id: 2, type: 'kanji', chars: '方', level: 3 }],           // not vocabulary → skipped
    [3, { id: 3, type: 'vocabulary', chars: '経済', level: 30, hidden: true }],
  ]);
  const assignments = new Map([[1, { startedAt: 1, stage: 6 }]]);
  const idx = wkVocabIndex(subjects, assignments);
  expect(idx.get('一方')).toEqual({ stage: 6, started: true, wkLevel: 14 });
  expect(idx.has('方') || idx.has('経済')).toBe(false);
});

test('jlptGap: covered = inDeck OR guru, with the overlap counted once', () => {
  // N3 words in MAP: あいにく, 一方, あらゆる
  const deckWords = new Set(['あいにく', '一方']);
  const wkIndex = new Map([
    ['一方', { stage: 6, started: true, wkLevel: 14 }],    // guru AND in deck → both
    ['あらゆる', { stage: 2, started: true, wkLevel: 20 }], // started but below guru → NOT covered
  ]);
  const gap = jlptGap(MAP, 'N3', deckWords, wkIndex);
  expect(gap).toEqual({ total: 3, covered: 2, inDeck: 2, guru: 1, both: 1, uncovered: ['あらゆる'] });
  expect(jlptGap(MAP, 'N3', new Set(), null).uncovered.length).toBe(3);
});

test('selectGapBatch tiers: off-WK first, locked-above, unlocked, started-below-guru last', () => {
  const entries = [
    ['学ぶ', 'まなぶ', 'to learn', 'verb', 'godan', 't'],      // started below guru → tier 4
    ['自由', 'じゆう', 'freedom', 'noun', '', ''],              // on WK, locked above user level → tier 2
    ['宝', 'たから', 'treasure', 'noun', '', ''],               // on WK, unlocked, not started → tier 3
    ['あらゆる', 'あらゆる', 'every', 'adjective', '', ''],      // not on WK → tier 1
    ['covered', 'covered', 'x', 'noun', '', ''],                // not uncovered → excluded
  ];
  const uncovered = ['学ぶ', '自由', '宝', 'あらゆる'];
  const wkIndex = new Map([
    ['学ぶ', { stage: 2, started: true, wkLevel: 10 }],
    ['自由', { stage: 0, started: false, wkLevel: 40 }],
    ['宝', { stage: 0, started: false, wkLevel: 15 }],
  ]);
  const batch = selectGapBatch(entries, uncovered, wkIndex, 22, 3);
  expect(batch.map((e) => e[0])).toEqual(['あらゆる', '自由', '宝']);
  expect(selectGapBatch(entries, uncovered, wkIndex, 22, 99).map((e) => e[0])).toEqual(['あらゆる', '自由', '宝', '学ぶ']);
});

test('buildJlptCard: minimal tagged card, jlptfill source flag + added day-stamp', () => {
  const c = buildJlptCard(['独り', 'ひとり', 'one person', 'noun', '', ''], 205, 'N3', '2026-07-01');
  expect(c).toEqual({
    rank: 205, jp: '独り', read: 'ひとり', mean: 'one person',
    cat: 'noun', type: '', trans: '', jlpt: 'N3',
    tags: ['JLPT', 'jlpt-n3'], jlptfill: true, added: '2026-07-01',
    mnem: '', tip: 'JLPT N3 word list', ex: [], accent: null, levels: null, custom: true,
  });
  expect(buildJlptCard(['ああ', '', 'like that', 'adverb', '', ''], 1, 'N5', 'd').read).toBe('ああ');
});

test('weeklyAddPace counts added-stamps in the trailing window, per level', () => {
  const data = [
    { jlpt: 'N3', added: '2026-07-01' },
    { jlpt: 'N3', added: '2026-06-28' },
    { jlpt: 'N3', added: '2026-06-20' },   // outside the 7-day window
    { jlpt: 'N4', added: '2026-07-01' },   // other level
    { jlpt: 'N3' },                        // no stamp (an older, pre-stamp card)
  ];
  expect(weeklyAddPace(data, '2026-07-01', 'N3')).toEqual({ today: 1, week: 2, avgPerDay: 2 / 7 });
});

test('weeklyAddPace: injected levelOf OVERRIDES the card`s own jlpt field, which may be a guess', () => {
  const data = [
    { jp: '経験', jlpt: 'N4', added: '2026-07-01' },   // Minna default says N4; the list says N3
    { jp: '猫', jlpt: 'N3', added: '2026-07-01' },     // card claims N3; the list says N5
  ];
  const levelOf = (v) => ({ 経験: 'N3', 猫: 'N5' })[v.jp] || '';
  // With the lookup: only 経験 counts. Without it, the card fields would give exactly the opposite.
  expect(weeklyAddPace(data, '2026-07-01', 'N3', { levelOf })).toMatchObject({ today: 1, week: 1 });
  expect(weeklyAddPace(data, '2026-07-01', 'N3')).toMatchObject({ today: 1, week: 1 });
  expect(weeklyAddPace(data, '2026-07-01', 'N5', { levelOf })).toMatchObject({ today: 1 });
  // levelOf fails soft ('' before the word-list chunk lands) → fall back to the card's own field.
  expect(weeklyAddPace(data, '2026-07-01', 'N3', { levelOf: () => '' })).toMatchObject({ today: 1 });
});

test('weeklyAddPace excludes grammar cards even though they carry jlpt:N3', () => {
  const data = [
    { jlpt: 'N3', added: '2026-07-01' },
    { jlpt: 'N3', added: '2026-07-01', grammar: true, grammarId: 'sei-de' },   // paced separately
  ];
  expect(weeklyAddPace(data, '2026-07-01', 'N3')).toMatchObject({ today: 1, week: 1 });
});

test('pacePlan verdicts: behind / on-track / ahead / done; null-safe on missing or past exam', () => {
  const gap = { total: 2069, covered: 869 };   // 1200 uncovered
  // 158 days − 14 buffer = 144 eff days → need ceil(1200/144)=9/day; at 12/day finish in 100d → slack 44
  const p = pacePlan({ daysLeft: 158, gap, targets: { wordsPerDay: 12, grammarPerWeek: 5 } });
  expect(p.effDays).toBe(158 - PACE_BUFFER_DAYS);
  expect(p.neededPerDay).toBe(9);
  expect(p.slackDays).toBe(44);
  expect(p.verdict).toBe('ahead');
  expect(pacePlan({ daysLeft: 158, gap, targets: { wordsPerDay: 5 } }).verdict).toBe('behind');
  expect(pacePlan({ daysLeft: 158, gap: { total: 10, covered: 10 }, targets: {} }).verdict).toBe('done');
  expect(pacePlan({ daysLeft: null, gap })).toBe(null);
  expect(pacePlan({ daysLeft: -3, gap })).toBe(null);
});

test('pacePlan grammar line: remaining vs weekly target', () => {
  const p = pacePlan({
    daysLeft: 158, gap: { total: 0, covered: 0 },
    targets: { grammarPerWeek: 5 }, grammar: { studied: 21, total: 81 },
  });
  // 60 remaining, ~20.6 weeks left, 12 weeks to finish at 5/week → ahead
  expect(p.grammar.remaining).toBe(60);
  expect(p.grammar.neededPerWeek).toBe(3);
  expect(p.grammar.verdict).toBe('ahead');
  expect(pacePlan({ daysLeft: 30, gap: { total: 0, covered: 0 }, targets: { grammarPerWeek: 5 }, grammar: { studied: 0, total: 81 } }).grammar.verdict).toBe('behind');
  expect(pacePlan({ daysLeft: 158, gap: { total: 0, covered: 0 }, grammar: null }).grammar).toBe(undefined);
});

/* ---- mock-test log (jlpt-followups) ----
   The one readiness signal the tab can't derive. Pins the settled blob shape, the pruning
   EXEMPTION (a mock from six months ago is the point), and the official pass criteria —
   including the trap that clearing the total but flunking a sectional minimum is a FAIL. */

const MOCK = (date, level, v, g, l, extra = {}) =>
  ({ id: `${date}-${level}`, date, level, scores: { vocab: v, grammarReading: g, listening: l }, total: v + g + l, ...extra });

test('mockTotal sums the three sections, clamping junk to 0 and each section to 60', () => {
  expect(mockTotal({ vocab: 40, grammarReading: 35, listening: 30 })).toBe(105);
  expect(mockTotal({ vocab: 40 })).toBe(40);                       // partial entry still totals
  expect(mockTotal({ vocab: 'x', grammarReading: -5, listening: 999 })).toBe(60);
  expect(mockTotal(null)).toBe(0);
});

test('normalizeMock drops unusable entries rather than inventing a 0/180 fail', () => {
  expect(normalizeMock(null)).toBe(null);
  expect(normalizeMock({ level: 'N3', scores: {} })).toBe(null);          // no date
  expect(normalizeMock({ date: 'yesterday', level: 'N3' })).toBe(null);   // bad date
  expect(normalizeMock({ date: '2026-08-01', level: 'N9' })).toBe(null);  // unknown level
  // Sections clamp to 0..60; the stored total is a cache and is RECOMPUTED.
  expect(normalizeMock({ date: '2026-08-01', level: 'N3', scores: { vocab: 70, grammarReading: -3, listening: 20 }, total: 999 }))
    .toEqual({ id: '2026-08-01-N3', date: '2026-08-01', level: 'N3', scores: { vocab: 60, grammarReading: 0, listening: 20 }, total: 80 });
  // Notes are trimmed + capped; blank notes drop the key entirely.
  expect(normalizeMock({ date: '2026-08-01', level: 'N3', notes: '  ' }).notes).toBe(undefined);
  expect(normalizeMock({ date: '2026-08-01', level: 'N3', notes: '  ran out of time  ' }).notes).toBe('ran out of time');
  expect(normalizeMock({ date: '2026-08-01', level: 'N3', notes: 'x'.repeat(600) }).notes.length).toBe(500);
});

test('normalizeMocks dedupes by id (last wins), sorts newest-first, and caps at 50', () => {
  const dupe = [MOCK('2026-08-01', 'N3', 10, 10, 10), MOCK('2026-08-01', 'N3', 50, 50, 50)];
  expect(normalizeMocks(dupe)).toHaveLength(1);
  expect(normalizeMocks(dupe)[0].total).toBe(150);                 // the LAST entry won
  const sorted = normalizeMocks([MOCK('2026-07-01', 'N3', 1, 1, 1), MOCK('2026-09-01', 'N3', 2, 2, 2), MOCK('2026-08-01', 'N3', 3, 3, 3)]);
  expect(sorted.map((m) => m.date)).toEqual(['2026-09-01', '2026-08-01', '2026-07-01']);
  const many = Array.from({ length: 60 }, (_, i) => MOCK(`2026-01-${String(i + 1).padStart(2, '0')}`, 'N3', 1, 1, 1));
  expect(normalizeMocks(many)).toHaveLength(JLPT_MOCKS_KEEP);
  expect(normalizeMocks('nope')).toEqual([]);
});

test('mocks are EXEMPT from the 60-day days{} pruning, and the key is omitted when empty', () => {
  const ancient = MOCK('2025-01-15', 'N3', 40, 40, 40);            // ~18 months before todayKey
  const out = normalizeJlpt({ mocks: [ancient], days: { '2025-01-15': { due: 1 } } }, '2026-07-08');
  expect(out.mocks).toHaveLength(1);                               // survived
  expect(out.days).toEqual({});                                    // …while the same-day record was pruned
  // A pre-mocks blob round-trips byte-identical (no `mocks` key materialized) — shouldSeed stays honest.
  expect('mocks' in normalizeJlpt({ level: 'N3' }, '2026-07-08')).toBe(false);
  expect('mocks' in normalizeJlpt({ mocks: [] }, '2026-07-08')).toBe(false);
  expect('mocks' in normalizeJlpt({ mocks: [{ date: 'junk' }] }, '2026-07-08')).toBe(false);
});

test('mockVerdict: clearing the TOTAL but flunking a sectional minimum is still a FAIL', () => {
  // N3 needs 95/180 overall AND ≥19 in each section.
  const strong = mockVerdict(MOCK('2026-08-01', 'N3', 55, 60, 50));
  expect(strong).toMatchObject({ pass: true, total: 165, totalOk: true, weakSections: [], needTotal: 95, needSection: 19 });

  const lopsided = mockVerdict(MOCK('2026-08-01', 'N3', 55, 60, 15));   // 130 total, listening 15
  expect(lopsided.total).toBe(130);
  expect(lopsided.totalOk).toBe(true);          // cleared 95 comfortably…
  expect(lopsided.weakSections).toEqual(['listening']);
  expect(lopsided.pass).toBe(false);            // …and still failed
  expect(lopsided.shortfall).toBe(0);

  const short = mockVerdict(MOCK('2026-08-01', 'N3', 30, 30, 25));      // 85 total, all sections ok
  expect(short).toMatchObject({ pass: false, totalOk: false, shortfall: 10, weakSections: [] });

  // Each mock is judged against ITS OWN level: 90/180 passes N2, not N3.
  expect(mockVerdict(MOCK('2026-08-01', 'N2', 30, 30, 30)).pass).toBe(true);
  expect(mockVerdict(MOCK('2026-08-01', 'N3', 30, 30, 30)).pass).toBe(false);
  expect(mockVerdict(null)).toBe(null);
});

test('mockTrend compares only same-level sittings, oldest→newest, with a delta and a best', () => {
  const mocks = normalizeMocks([
    MOCK('2026-07-01', 'N3', 30, 30, 30),   // 90
    MOCK('2026-08-01', 'N3', 40, 35, 30),   // 105
    MOCK('2026-08-15', 'N4', 55, 55, 55),   // a different paper — must not pollute the N3 trend
  ]);
  const t = mockTrend(mocks, 'N3');
  expect(t.points.map((p) => p.total)).toEqual([90, 105]);   // chronological
  expect(t.latest.date).toBe('2026-08-01');
  expect(t.delta).toBe(15);
  expect(t.best).toBe(105);
  expect(mockTrend(mocks, 'N1')).toBe(null);
  expect(mockTrend(normalizeMocks([MOCK('2026-07-01', 'N3', 30, 30, 30)]), 'N3').delta).toBe(null);  // one sitting
});

test('mergeJlpt unions mocks by id with LOCAL winning, and re-caps', () => {
  const local = { level: 'N3', mocks: [MOCK('2026-08-01', 'N3', 50, 50, 50)] };
  const server = { level: 'N3', mocks: [MOCK('2026-08-01', 'N3', 10, 10, 10), MOCK('2026-07-01', 'N3', 20, 20, 20)] };
  const m = mergeJlpt(local, server);
  expect(m.mocks).toHaveLength(2);                                  // union
  expect(m.mocks.find((x) => x.date === '2026-08-01').total).toBe(150);   // local won the collision
  expect(m.mocks.find((x) => x.date === '2026-07-01').total).toBe(60);    // server-only entry survived
  expect(m.mocks.map((x) => x.date)).toEqual(['2026-08-01', '2026-07-01']);  // newest first
  // Neither side has mocks → no key (matches normalizeJlpt).
  expect('mocks' in mergeJlpt({ level: 'N3' }, { level: 'N3' })).toBe(false);
});
