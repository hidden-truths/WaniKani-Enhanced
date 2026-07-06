// Pure-core tests for the N3 grammar system (src/core/grammar.js): card building, example
// rotation, cloze blank/render (composed with the REAL core/songs.js clozeLineParts), coverage
// statuses, and the reviewed-today signal. Plus catalog invariants over the real generated
// data/grammar-n3.js (the core.test.ts built-ins precedent) so a bad content regen fails loudly.
import { test, expect } from 'vitest';
import {
  buildGrammarCard, pickGrammarExample, grammarBlank, clozePartsToHtml,
  grammarDeckIndex, grammarCoverage, grammarReviewedToday,
} from '../src/core/grammar.js';
import { clozeLineParts } from '../src/core/songs.js';
import { plainText, rubyToSegments, isCleanRuby } from '../src/core/text.js';
import { mergeProgress } from '../src/core/merge.js';
import { GRAMMAR_N3 } from '../src/data/grammar-n3.js';

const POINT = {
  id: 'you-ni-naru', label: '〜ようになる', read: 'ようになる',
  mean: 'come to', jlpt: 'N3',
  explanation: 'x', formation: 'V-dict + ようになる',
  examples: [
    { jp: '<ruby>泳<rt>およ</rt></ruby>げるようになった。', en: 'Became able to swim.', blank: 'ようになった' },
    { jp: '<ruby>起<rt>お</rt></ruby>きるようになる。', en: 'Come to get up.', blank: 'ようになる' },
  ],
};

test('buildGrammarCard: the tagged custom-card snapshot, content by grammarId reference', () => {
  expect(buildGrammarCard(POINT, 301)).toEqual({
    rank: 301, jp: '〜ようになる', read: 'ようになる', mean: 'come to',
    cat: 'grammar', type: '', trans: '', jlpt: 'N3', tags: ['文法'],
    grammar: true, grammarId: 'you-ni-naru',
    mnem: '', tip: '', ex: [], accent: null, levels: null, custom: true,
  });
});

test('pickGrammarExample rotates deterministically by attempt count', () => {
  expect(pickGrammarExample(POINT.examples, 0)).toBe(POINT.examples[0]);
  expect(pickGrammarExample(POINT.examples, 1)).toBe(POINT.examples[1]);
  expect(pickGrammarExample(POINT.examples, 2)).toBe(POINT.examples[0]);
  expect(pickGrammarExample([], 3)).toBe(null);
  expect(pickGrammarExample(null, 0)).toBe(null);
});

test('grammarBlank: offsets into plainText; missing/foreign blank fails soft to []', () => {
  expect(grammarBlank(POINT.examples[0])).toEqual([{ start: 3, end: 9, surface: 'ようになった' }]);
  expect(grammarBlank({ jp: 'x', blank: 'zzz' })).toEqual([]);
  expect(grammarBlank({ jp: 'x' })).toEqual([]);
});

test('cloze render round-trip through the real clozeLineParts: gap face hides, reveal face marks', () => {
  const ex = POINT.examples[0];
  const line = { text: plainText(ex.jp), furigana: rubyToSegments(ex.jp) };
  const parts = clozeLineParts(line, grammarBlank(ex));
  const gap = clozePartsToHtml(parts, 'gap');
  expect(gap).toContain('<ruby>泳<rt>およ</rt></ruby>');
  expect(gap).toContain('cloze-gap');
  expect(gap).not.toContain('ようになった');                       // the answer is hidden
  const reveal = clozePartsToHtml(parts, 'reveal');
  expect(reveal).toContain('<mark class="gp-hit">ようになった</mark>');
});

test('clozePartsToHtml escapes text runs; gap width is clamped (no length giveaway)', () => {
  expect(clozePartsToHtml([{ type: 'text', t: '<b>x</b>' }], 'gap')).toBe('&lt;b&gt;x&lt;/b&gt;');
  const short = clozePartsToHtml([{ type: 'gap', surface: 'に' }], 'gap');
  const long = clozePartsToHtml([{ type: 'gap', surface: 'わけにはいきません' }], 'gap');
  expect(short).toContain('＿＿');
  expect(long).toContain('＿＿＿＿＿＿');
  expect(long).not.toContain('＿＿＿＿＿＿＿');
});

test('grammarDeckIndex + grammarCoverage statuses: new / added / learning / solid', () => {
  const points = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const data = [
    { rank: 1, grammar: true, grammarId: 'a' },
    { rank: 2, grammar: true, grammarId: 'b' },
    { rank: 3, grammar: true, grammarId: 'c' },
    { rank: 4, jp: 'ordinary card' },
  ];
  const cards = { 1: { box: 5 }, 2: { box: 2 } };   // c has no stat → box 0 → 'added'
  expect(grammarDeckIndex(data)).toEqual(new Set(['a', 'b', 'c']));
  const cov = grammarCoverage(points, data, cards);
  expect(cov.total).toBe(4);
  expect(cov.inDeck).toBe(3);
  expect(cov.solid).toBe(1);
  expect(cov.learning).toBe(1);
  expect(cov.points.map((p) => p.status)).toEqual(['solid', 'learning', 'added', 'new']);
});

test('grammarReviewedToday reads the `last` grade-stamp against local midnight', () => {
  const dayStart = Date.parse('2026-07-01T00:00:00');
  const data = [{ rank: 1, grammar: true, grammarId: 'a' }, { rank: 2, jp: 'x' }];
  expect(grammarReviewedToday(data, { 1: { last: dayStart + 1000 } }, dayStart)).toBe(true);
  expect(grammarReviewedToday(data, { 1: { last: dayStart - 1000 } }, dayStart)).toBe(false);
  expect(grammarReviewedToday(data, { 2: { last: dayStart + 1000 } }, dayStart)).toBe(false);  // non-grammar card
  expect(grammarReviewedToday([], {}, dayStart)).toBe(false);
});

test('mergeProgress carries `last` with max (the explicit field list would drop it otherwise)', () => {
  const m = mergeProgress(
    { cards: { 1: { attempts: [1], right: 1, wrong: 0, box: 1, due: 5, last: 100 } } },
    { cards: { 1: { attempts: [1], right: 1, wrong: 0, box: 1, due: 5, last: 200 } } },
  );
  expect(m.cards[1].last).toBe(200);
  const noLast = mergeProgress({ cards: { 1: { box: 1 } } }, { cards: { 1: { box: 2 } } });
  expect('last' in noLast.cards[1]).toBe(false);   // no stamp on either side → key stays absent
});

/* ---- catalog invariants over the real generated module ------------------------- */

test('grammar-n3 catalog: unique durable ids, 3–5 clean examples, blanks resolvable', () => {
  expect(GRAMMAR_N3.length).toBeGreaterThan(0);
  const ids = new Set();
  for (const p of GRAMMAR_N3) {
    expect(ids.has(p.id), `duplicate id ${p.id}`).toBe(false);
    ids.add(p.id);
    expect(p.label && p.read && p.mean && p.explanation && p.formation, `${p.id}: incomplete`).toBeTruthy();
    expect(p.examples.length, `${p.id}: examples`).toBeGreaterThanOrEqual(3);
    expect(p.examples.length, `${p.id}: examples`).toBeLessThanOrEqual(5);
    for (const ex of p.examples) {
      expect(isCleanRuby(ex.jp), `${p.id}: dirty ruby`).toBe(true);
      expect(ex.en, `${p.id}: missing en`).toBeTruthy();
      expect(plainText(ex.jp).includes(ex.blank), `${p.id}: blank not in plain text`).toBe(true);
    }
  }
});
