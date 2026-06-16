// Songs analysis — the PURE assembly (server-side UTF-16 offset computation, furigana validation,
// grammar filtering, per-line flagging). The Claude call (analyzeLyrics) is integration-only and not
// tested here; this covers the bookkeeping that turns a model's raw output into validated, offset-
// resolved lines. The offset invariant (text.slice(start,end)===surface) is the load-bearing one —
// it's what the tap-to-lookup UI relies on.

import { describe, test, expect } from 'bun:test';
import { assembleAnalysis, offsetTokens, type ModelOutput } from './songAnalyze.ts';

describe('assembleAnalysis — offsets + validation + flags', () => {
    test('a clean line: furigana validates, tokens get correct UTF-16 offsets, grammar is catalog-filtered', () => {
        const out: ModelOutput = {
            profile: { jlpt: 'N5' },
            lines: [
                {
                    index: 0,
                    furigana: [{ t: '歌', r: 'うた' }, { t: 'を' }, { t: '歌', r: 'うた' }, { t: 'う' }],
                    en: 'I sing a song',
                    grammar: ['tai', 'not-a-real-id'], // unknown id is dropped
                    tokens: [
                        { surface: '歌', lemma: '歌', reading: 'うた', pos: 'noun', jlpt: 'N5', gloss: 'song' },
                        { surface: '歌う', lemma: '歌う', reading: 'うたう', pos: 'verb', jlpt: 'N5', gloss: 'to sing' },
                    ],
                },
            ],
        };
        const r = assembleAnalysis(['歌を歌う'], out);
        const line = r.lines[0]!;
        expect(line.flags).toEqual([]);
        expect(line.furigana).not.toBeNull();
        expect(line.en).toBe('I sing a song');
        expect(line.grammar).toEqual(['tai']); // unknown id filtered out
        // The second 歌 must align AFTER the first (cursor advances), not back at index 0.
        expect(line.tokens.map((t) => [t.surface, t.start, t.end])).toEqual([
            ['歌', 0, 1],
            ['歌う', 2, 4],
        ]);
        // THE invariant: every token's [start,end) reconstructs its surface under JS string slicing.
        for (const t of line.tokens) expect('歌を歌う'.slice(t.start, t.end)).toBe(t.surface);
        expect(line.tokens[0]!.pos).toBe('NOUN'); // pos upper-cased
        expect(line.tokens[0]!.jlpt).toBe('N5');
        expect(line.tokens[0]!.gloss).toBe('song');
        expect(r.profile).toEqual({ jlpt: 'N5', grammarCount: 1, lineCount: 1 });
    });

    test('furigana that does not reconstruct the line is dropped + flagged (falls back to plain text)', () => {
        const out: ModelOutput = { lines: [{ index: 0, furigana: [{ t: 'ちがう' }], en: 'x' }] };
        const line = assembleAnalysis(['ほんとう'], out).lines[0]!;
        expect(line.furigana).toBeNull();
        expect(line.flags).toContain('furigana');
    });

    test('tokens whose surfaces cannot be aligned in order are dropped + flagged (plain ruby)', () => {
        const out: ModelOutput = { lines: [{ index: 0, tokens: [{ surface: 'ない' }] }] };
        const line = assembleAnalysis(['あ'], out).lines[0]!; // 'ない' is not in 'あ'
        expect(line.tokens).toEqual([]);
        expect(line.flags).toContain('tokens');
    });

    test('a line with no model analysis is flagged missing (still carries its text)', () => {
        const out: ModelOutput = { lines: [{ index: 0, en: 'first' }] };
        const r = assembleAnalysis(['いち', 'に'], out);
        expect(r.lines[0]!.en).toBe('first');
        expect(r.lines[1]!.flags).toEqual(['missing']);
        expect(r.lines[1]!.text).toBe('に'); // text preserved even when unanalyzed
        expect(r.lines[1]!.furigana).toBeNull();
    });

    test("the model's self-flag surfaces as 'low-confidence'", () => {
        const out: ModelOutput = { lines: [{ index: 0, flag: true, furigana: [{ t: 'あ' }] }] };
        expect(assembleAnalysis(['あ'], out).lines[0]!.flags).toContain('low-confidence');
    });

    test('grammarCount counts DISTINCT catalog ids across lines', () => {
        const out: ModelOutput = {
            lines: [
                { index: 0, grammar: ['tai', 'nagara'] },
                { index: 1, grammar: ['tai'] }, // repeat → not double-counted
            ],
        };
        expect(assembleAnalysis(['a', 'b'], out).profile.grammarCount).toBe(2);
    });

    test('a particle between content words does not break alignment (cursor skips non-token chars)', () => {
        const out: ModelOutput = {
            lines: [{ index: 0, tokens: [
                { surface: '朝日', lemma: '朝日', reading: 'あさひ', pos: 'NOUN' },
                { surface: '昇る', lemma: '昇る', reading: 'のぼる', pos: 'VERB' },
            ] }],
        };
        const text = '朝日がゆっくり昇る';
        const line = assembleAnalysis([text], out).lines[0]!;
        expect(line.tokens.map((t) => text.slice(t.start, t.end))).toEqual(['朝日', '昇る']);
        expect(line.flags).toEqual([]);
    });
});

// offsetTokens is exported so the curated-starter seed (scripts/seed-songs.ts) computes offsets the
// SAME way — one routine, no drift between hand-authored seed tokens and model-authored runtime ones.
describe('offsetTokens — in-order UTF-16 offset computation (also reused by the song seed)', () => {
    test('computes start/end so text.slice===surface; a repeated surface aligns to the NEXT occurrence', () => {
        const text = '歌を歌う';
        const toks = offsetTokens(text, [{ surface: '歌', pos: 'noun' }, { surface: '歌う', pos: 'verb' }]);
        expect(toks).not.toBeNull();
        expect(toks!.map((t) => [t.start, t.end])).toEqual([[0, 1], [2, 4]]); // 2nd 歌 after the cursor, not back at 0
        for (const t of toks!) expect(text.slice(t.start, t.end)).toBe(t.surface);
        expect(toks![0]!.pos).toBe('NOUN'); // pos upper-cased; lemma/reading defaulted
        expect(toks![0]!.lemma).toBe('歌');
    });

    test('non-BMP surface (surrogate pair) gets UTF-16 (not codepoint) offsets', () => {
        const text = '𠮟る'; // 𠮟 = U+20B9F, one codepoint = TWO UTF-16 code units
        const toks = offsetTokens(text, [{ surface: '𠮟る', lemma: '𠮟る', pos: 'VERB' }])!;
        expect(toks[0]!.end).toBe(3); // 2 units for 𠮟 + 1 for る — codepoint length would be 2
        expect(text.slice(toks[0]!.start, toks[0]!.end)).toBe('𠮟る');
    });

    test('returns null when a surface cannot be aligned in order (→ seed aborts / analyzer flags)', () => {
        expect(offsetTokens('あ', [{ surface: 'ない', pos: 'verb' }])).toBeNull();
        expect(offsetTokens('歌う歌', [{ surface: '歌', pos: 'noun' }, { surface: '歌う', pos: 'verb' }])).toBeNull(); // 歌う is before the 2nd 歌
    });
});
