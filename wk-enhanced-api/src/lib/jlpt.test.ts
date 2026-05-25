// JLPT scoring is a port of the userscript's scoreJlpt with deliberate
// fail-open semantics. These tests pin down the edge cases so future
// refactors (e.g. adding morphological analysis) can't silently break the
// "unknown tokens shouldn't filter out sentences" guarantee.
//
// Level scheme (from JLPT_VOCAB): 5=N5 easiest, 1=N1 hardest, 0=unknown.

import { describe, test, expect } from 'bun:test';
import { scoreJlpt } from './jlpt.ts';

describe('scoreJlpt', () => {
    test('empty wordList returns 0 (unknown)', () => {
        expect(scoreJlpt([], '食べる')).toBe(0);
        expect(scoreJlpt(undefined, '食べる')).toBe(0);
    });

    test('all-unknown tokens returns 0 (fail-open sentinel)', () => {
        // Nonsense tokens not in JLPT_VOCAB. Returning 0 means the sentence
        // passes any ceiling filter — the explicit "we don't know, don't
        // filter it out" behavior the userscript depends on.
        expect(scoreJlpt(['zzzfoo', 'zzzbar'], '食べる')).toBe(0);
    });

    test('target word is excluded from scoring', () => {
        // If the only "hard" word is the target itself, don't penalize the
        // sentence for it. Only surrounding context counts.
        // 食べる is N5. With it as the only token AND the target, score = 0.
        expect(scoreJlpt(['食べる'], '食べる')).toBe(0);
    });

    test('single N5 token returns 5', () => {
        expect(scoreJlpt(['私'], '食べる')).toBe(5); // 私 = N5
    });

    test('hardest level (lowest number) wins among known tokens', () => {
        // 私=N5(5), 経済=N4(4). The harder (lower number) determines difficulty.
        expect(scoreJlpt(['私', '経済'], '食べる')).toBe(4);
    });

    test('hardest wins across a mix spanning many levels', () => {
        // 私=N5(5), 一方=N3(3), 一切=N1(1). N1 is hardest.
        expect(scoreJlpt(['私', '一方', '一切'], '食べる')).toBe(1);
    });

    test('unknown tokens are skipped when known tokens are present', () => {
        // 私 is N5 known; "zzzfoo" is unknown and silently ignored.
        // Score = 5 (the only known token).
        expect(scoreJlpt(['私', 'zzzfoo'], '食べる')).toBe(5);
    });

    test('target word excluded even when it would otherwise be the hardest', () => {
        // 一切 is N1; treat it as the target and surround with N5 私.
        // The N1 target shouldn't inflate the sentence difficulty.
        expect(scoreJlpt(['一切', '私'], '一切')).toBe(5);
    });

    test('empty/null tokens are silently skipped', () => {
        // word_list occasionally contains empty strings (delimiters from
        // IK's tokenizer). They shouldn't trip the loop.
        expect(scoreJlpt(['', '私', ''], '食べる')).toBe(5);
    });
});
