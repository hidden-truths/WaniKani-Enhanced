// Pure-core tests for the 合格 JLPT lens (src/core/jlpt.js) — the word-list map +
// lookups, exam countdown, deck/WaniKani coverage, and the daily-checklist record ops
// (normalize/merge/heat). All time-dependent functions take injected nowMs/dayKey
// (project convention).
import { test, expect } from 'vitest';
import {
  JLPT_LEVEL_ORDER, buildJlptMap, jlptLookup, jlptLevelTotal, examCountdown,
  deckJlptCoverage, wkJlptCoverage, normalizeJlpt, mergeJlpt, shiftDay, checklistHeat,
  JLPT_DAYS_KEEP,
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
