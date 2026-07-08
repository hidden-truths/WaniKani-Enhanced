// Pure-core tests for the wave-2 文法形式判断 drill (src/core/grammar-mcq.js): stem gap handling,
// deterministic quiz assembly (question order AND choice order shuffled), scoring, the per-run
// weak-point list, and the DURABLE per-point score trail (normalize / apply / merge / stat /
// weakest). Plus bank invariants over the REAL generated data/grammar-n3-mcq.js — the grammar-core
// catalog-invariant precedent — so a bad regen or a hand-edit of the generated file fails loudly.
import { test, expect } from 'vitest';
import {
  MCQ_GAP, MCQ_CHOICES, splitStem, fillGap, shuffle, seededRand,
  buildMcqQuiz, scoreMcq, weakPoints, mcqPointIds, mcqQuestionCount,
  normalizeMcqTrail, applyMcqResult, mergeMcqTrail, mcqStat, weakestMcqPoints,
} from '../src/core/grammar-mcq.js';
import { GRAMMAR_N3_MCQ } from '../src/data/grammar-n3-mcq.js';
import { GRAMMAR_N3 } from '../src/data/grammar-n3.js';
import { isCleanRuby, plainText } from '../src/core/text.js';

const BANK = {
  'a-point': [
    { stem: `私は${MCQ_GAP}です。`, choices: ['A', 'B', 'C', 'D'], answer: 0, why: 'because A' },
    { stem: `君も${MCQ_GAP}だ。`, choices: ['E', 'F', 'G', 'H'], answer: 2, why: 'because G' },
  ],
  'b-point': [
    { stem: `彼が${MCQ_GAP}。`, choices: ['I', 'J', 'K', 'L'], answer: 3, why: 'because L' },
  ],
};

test('splitStem / fillGap round-trip around the single gap', () => {
  expect(splitStem(`私は${MCQ_GAP}です。`)).toEqual(['私は', 'です。']);
  expect(fillGap(`私は${MCQ_GAP}です。`, '学生')).toBe('私は学生です。');
  // No gap (the builder errors on this) degrades instead of throwing.
  expect(splitStem('がない')).toEqual(['がない', '']);
  expect(splitStem(null)).toEqual(['', '']);
  expect(fillGap(null, 'x')).toBe('x');
});

test('shuffle is a permutation, does not mutate, and is deterministic per rand', () => {
  const src = [1, 2, 3, 4, 5];
  const out = shuffle(src, seededRand(42));
  expect(src).toEqual([1, 2, 3, 4, 5]);            // untouched
  expect([...out].sort()).toEqual([1, 2, 3, 4, 5]); // same multiset
  expect(shuffle(src, seededRand(42))).toEqual(out);        // same seed → same order
  expect(shuffle(src, seededRand(43))).not.toEqual(src);    // (a different seed does something)
});

test('seededRand yields values in [0,1) and is reproducible', () => {
  const draw = (seed) => { const r = seededRand(seed); return Array.from({ length: 50 }, () => r()); };
  const a = draw(7);
  expect(a.every((x) => x >= 0 && x < 1)).toBe(true);
  expect(new Set(a).size).toBeGreaterThan(40);   // not a constant
  expect(draw(7)).toEqual(a);                    // same seed → same stream
  expect(draw(8)).not.toEqual(a);
});

test('buildMcqQuiz shuffles the CHOICES, not just the questions — the answer index must move', () => {
  // Every bank question stores its answer at a fixed index; a drill that renders them in bank order
  // would teach position. Across seeds, the correct choice must land in different slots.
  const seen = new Set();
  for (let s = 0; s < 40; s++) {
    const [q] = buildMcqQuiz({ solo: [BANK['a-point'][0]] }, { n: 1, rand: seededRand(s) });
    expect(q.choices[q.answer]).toBe('A');            // …and it always points at the RIGHT choice
    expect([...q.choices].sort()).toEqual(['A', 'B', 'C', 'D']);
    seen.add(q.answer);
  }
  expect(seen.size).toBeGreaterThan(1);
});

test('buildMcqQuiz caps at n, spans points, carries pointId, and is deterministic', () => {
  const all = buildMcqQuiz(BANK, { n: 99, rand: seededRand(1) });
  expect(all).toHaveLength(3);                                  // the whole bank
  expect(new Set(all.map((q) => q.pointId))).toEqual(new Set(['a-point', 'b-point']));
  expect(buildMcqQuiz(BANK, { n: 2, rand: seededRand(1) })).toHaveLength(2);
  expect(buildMcqQuiz(BANK, { n: 2, rand: seededRand(1) })).toEqual(buildMcqQuiz(BANK, { n: 2, rand: seededRand(1) }));
  // `ids` restricts the pool; an unknown id contributes nothing.
  expect(buildMcqQuiz(BANK, { ids: ['b-point'], n: 9, rand: seededRand(1) }).map((q) => q.pointId)).toEqual(['b-point']);
  expect(buildMcqQuiz(BANK, { ids: ['nope'], n: 9, rand: seededRand(1) })).toEqual([]);
  expect(buildMcqQuiz({}, { n: 5 })).toEqual([]);
  expect(buildMcqQuiz(null, { n: 5 })).toEqual([]);
  expect(buildMcqQuiz(BANK, { n: 0, rand: seededRand(1) })).toHaveLength(1);   // n floors at 1
});

test('mcqPointIds / mcqQuestionCount', () => {
  expect(mcqPointIds(BANK)).toEqual(['a-point', 'b-point']);
  expect(mcqQuestionCount(BANK)).toBe(3);
  expect(mcqQuestionCount(null)).toBe(0);
  expect(mcqPointIds(null)).toEqual([]);
});

test('scoreMcq tallies overall and per point; weakPoints ranks the misses worst-first', () => {
  const results = [
    { pointId: 'a', correct: true }, { pointId: 'a', correct: false },
    { pointId: 'b', correct: false }, { pointId: 'b', correct: false },
    { pointId: 'c', correct: true },
  ];
  const sc = scoreMcq(results);
  expect(sc).toMatchObject({ right: 2, total: 5, pct: 40 });
  expect(sc.byPoint).toEqual({ a: { right: 1, wrong: 1 }, b: { right: 0, wrong: 2 }, c: { right: 1, wrong: 0 } });
  expect(weakPoints(sc.byPoint)).toEqual(['b', 'a']);          // b missed twice, a once; c clean
  expect(weakPoints({})).toEqual([]);
  expect(scoreMcq([])).toMatchObject({ right: 0, total: 0, pct: 0 });
  expect(scoreMcq(null).total).toBe(0);
});

// ---- Bank invariants over the REAL generated chunk ----

const bankEntries = Object.entries(GRAMMAR_N3_MCQ);
const catalogIds = new Set(GRAMMAR_N3.map((p) => p.id));

test('every bank keys on a DURABLE catalog point id', () => {
  const orphans = bankEntries.map(([id]) => id).filter((id) => !catalogIds.has(id));
  expect(orphans).toEqual([]);
  expect(bankEntries.length).toBeGreaterThan(0);
});

test('every question: one gap, four distinct plain-text choices, an in-range answer, a real "why"', () => {
  const bad = [];
  for (const [id, qs] of bankEntries) {
    qs.forEach((q, i) => {
      const at = `${id}[${i}]`;
      if (q.stem.split(MCQ_GAP).length - 1 !== 1) bad.push(`${at}: gap count`);
      if (!isCleanRuby(q.stem)) bad.push(`${at}: stem ruby`);
      if (q.choices.length !== MCQ_CHOICES) bad.push(`${at}: choice count`);
      if (new Set(q.choices).size !== q.choices.length) bad.push(`${at}: duplicate choice`);
      if (q.choices.some((c) => /[<>]/.test(c))) bad.push(`${at}: markup in a choice`);
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= MCQ_CHOICES) bad.push(`${at}: answer index`);
      if (!q.why || q.why.length < 20) bad.push(`${at}: why too short`);
    });
  }
  expect(bad).toEqual([]);
});

test('every filled stem reads as a complete sentence (no stray gap, ends in a full stop)', () => {
  const bad = [];
  for (const [id, qs] of bankEntries) {
    qs.forEach((q, i) => {
      const filled = plainText(fillGap(q.stem, q.choices[q.answer]));
      if (filled.includes(MCQ_GAP)) bad.push(`${id}[${i}]: gap survives the fill`);
      if (!filled.endsWith('。')) bad.push(`${id}[${i}]: "${filled}" doesn't end in 。`);
    });
  }
  expect(bad).toEqual([]);
});

test('a real quiz over the shipped bank never mislabels its answer', () => {
  const quiz = buildMcqQuiz(GRAMMAR_N3_MCQ, { n: 50, rand: seededRand(99) });
  expect(quiz.length).toBe(Math.min(50, mcqQuestionCount(GRAMMAR_N3_MCQ)));
  for (const q of quiz) {
    const original = GRAMMAR_N3_MCQ[q.pointId][q.index];
    expect(q.choices[q.answer]).toBe(original.choices[original.answer]);
    expect([...q.choices].sort()).toEqual([...original.choices].sort());
  }
});

/* ---- the per-point score trail ------------------------------------------------------------- */

test('normalizeMcqTrail drops junk ids, coerces counters, and omits empty entries', () => {
  expect(normalizeMcqTrail(null)).toEqual({});
  expect(normalizeMcqTrail({
    'ta-bakari': { right: 3, wrong: '1', last: '2026-07-08' },
    'Bad Id': { right: 5, wrong: 0 },                  // not a kebab-case point id
    'kuse-ni': { right: 0, wrong: 0 },                 // never actually answered → dropped
    'sei-de': { right: -2, wrong: 1.6, last: 'nope' }, // negatives floor to 0, junk day dropped
    'okage-de': 'not an object',
  })).toEqual({
    'ta-bakari': { right: 3, wrong: 1, last: '2026-07-08' },
    'sei-de': { right: 0, wrong: 2 },
  });
});

test('applyMcqResult is pure and bumps exactly one counter', () => {
  const before = { 'sei-de': { right: 1, wrong: 1, last: '2026-07-01' } };
  const after = applyMcqResult(before, 'sei-de', true, '2026-07-08');
  expect(before['sei-de']).toEqual({ right: 1, wrong: 1, last: '2026-07-01' });  // untouched
  expect(after['sei-de']).toEqual({ right: 2, wrong: 1, last: '2026-07-08' });
  expect(applyMcqResult({}, 'kuse-ni', false, '2026-07-08')['kuse-ni']).toEqual({ right: 0, wrong: 1, last: '2026-07-08' });
  expect(applyMcqResult({}, 'Bad Id', true, '2026-07-08')).toEqual({});          // junk id never lands
  // No/invalid day → the previous `last` survives rather than being clobbered with junk.
  expect(applyMcqResult(before, 'sei-de', true)['sei-de']).toEqual({ right: 2, wrong: 1, last: '2026-07-01' });
});

test('mergeMcqTrail takes the per-point MAX, never the sum (counters are monotonic)', () => {
  const local = { 'sei-de': { right: 5, wrong: 2, last: '2026-07-08' }, 'kuse-ni': { right: 1, wrong: 0 } };
  const server = { 'sei-de': { right: 4, wrong: 3, last: '2026-07-09' }, 'tabi-ni': { right: 0, wrong: 2 } };
  expect(mergeMcqTrail(local, server)).toEqual({
    // Both sides already contain the shared history — summing would double-count it.
    'sei-de': { right: 5, wrong: 3, last: '2026-07-09' },   // field-wise max; latest day wins
    'kuse-ni': { right: 1, wrong: 0 },
    'tabi-ni': { right: 0, wrong: 2 },
  });
  expect(mergeMcqTrail(null, null)).toEqual({});
  // Idempotent: merging a trail with itself can't inflate it.
  expect(mergeMcqTrail(local, local)).toEqual(normalizeMcqTrail(local));
});

test('mcqStat returns null for an undrilled point, else the lifetime record', () => {
  const trail = { 'sei-de': { right: 3, wrong: 1 } };
  expect(mcqStat(trail, 'kuse-ni')).toBe(null);
  expect(mcqStat(trail, 'sei-de')).toEqual({ right: 3, wrong: 1, seen: 4, pct: 75, last: undefined });
});

test('weakestMcqPoints is worst-first, bank-restricted, and DRAINS as accuracy recovers', () => {
  const trail = {
    'sei-de': { right: 1, wrong: 3 },      // 25%
    'kuse-ni': { right: 2, wrong: 2 },     // 50%
    'tabi-ni': { right: 9, wrong: 1 },     // 90% — above the threshold, not weak
    'okage-de': { right: 0, wrong: 1 },    // only 1 sighting
    'ni-yoru-to': { right: 0, wrong: 4 },  // 0% but NOT in the bank below
  };
  const banked = ['sei-de', 'kuse-ni', 'tabi-ni', 'okage-de'];
  expect(weakestMcqPoints(trail, banked, { minSeen: 2, maxPct: 75 })).toEqual(['sei-de', 'kuse-ni']);
  // minSeen guards the one-unlucky-tap case; lowering it lets the single miss through.
  expect(weakestMcqPoints(trail, banked, { minSeen: 1, maxPct: 75 })).toEqual(['okage-de', 'sei-de', 'kuse-ni']);
  expect(weakestMcqPoints(trail, banked, { minSeen: 2, maxPct: 75, n: 1 })).toEqual(['sei-de']);
  // THE point of the accuracy threshold: answer 'sei-de' right enough times and it leaves the list,
  // where a `wrong > 0` rule would pin it there forever.
  let t = trail;
  for (let i = 0; i < 8; i++) t = applyMcqResult(t, 'sei-de', true, '2026-07-08');
  expect(mcqStat(t, 'sei-de').pct).toBe(75);
  expect(weakestMcqPoints(t, banked, { minSeen: 2, maxPct: 75 })).toEqual(['kuse-ni']);
  expect(weakestMcqPoints({}, banked, { minSeen: 2, maxPct: 75 })).toEqual([]);
});
