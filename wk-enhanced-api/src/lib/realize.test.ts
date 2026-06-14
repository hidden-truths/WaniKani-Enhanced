// Realization port (lib/realize.ts) — must stay byte-for-byte aligned with the study-app's
// core/selftalk.js realizeTemplate + core/text.js plainText/rubyToSegments, since a server-
// materialized combo's text/hash/furigana have to equal what the client derives + plays.

import { describe, test, expect } from 'bun:test';
import { realizeTemplate, plainText, rubyToSegments, templatePickIndex } from './realize.ts';

const tpl = {
    jp: '{material}を<ruby>集<rt>あつ</rt></ruby>めよう。',
    en: "Let's gather {material}.",
    slots: [
        {
            id: 'material',
            label: 'material',
            fillers: [
                { jp: '<ruby>木<rt>き</rt></ruby>', en: 'wood' },
                { jp: '<ruby>石<rt>いし</rt></ruby>', en: 'stone' },
            ],
        },
    ],
};

describe('realizeTemplate (server port)', () => {
    test('substitutes the picked filler + derives jp/text/furigana/mean/role', () => {
        const r = realizeTemplate(tpl, { material: 0 });
        expect(r.jp).toBe('<ruby>木<rt>き</rt></ruby>を<ruby>集<rt>あつ</rt></ruby>めよう。');
        expect(r.text).toBe('木を集めよう。');
        expect(r.mean).toBe("Let's gather wood.");
        expect(r.role).toBe('material:0');
        // furigana reconstructs text (the structural-furigana invariant)
        expect(r.furigana.map((s) => s.t).join('')).toBe(r.text);
        expect(r.furigana).toEqual([{ t: '木', r: 'き' }, { t: 'を' }, { t: '集', r: 'あつ' }, { t: 'めよう。' }]);
    });

    test('a different pick changes the realization + role', () => {
        const r = realizeTemplate(tpl, { material: 1 });
        expect(r.text).toBe('石を集めよう。');
        expect(r.mean).toBe("Let's gather stone.");
        expect(r.role).toBe('material:1');
    });

    test('out-of-range pick clamps to the last filler; missing → default 0; role canonical over ALL slots', () => {
        // i=99 clamps to n-1 = 1 (the LAST filler, stone), not wraps and not 0.
        expect(realizeTemplate(tpl, { material: 99 }).text).toBe('石を集めよう。');
        expect(realizeTemplate(tpl, { material: 99 }).role).toBe('material:1');
        // an empty picks object still names the default (index 0) in the role — canonical, not sparse.
        expect(realizeTemplate(tpl, {}).role).toBe('material:0');
        expect(realizeTemplate(tpl, {}).text).toBe('木を集めよう。');
    });

    test('a two-slot template builds a multi-part role in skeleton order', () => {
        const t2 = {
            jp: '{a}と{b}。',
            en: '{a} and {b}.',
            slots: [
                { id: 'a', label: 'a', fillers: [{ jp: 'X', en: 'x' }, { jp: 'Y', en: 'y' }] },
                { id: 'b', label: 'b', fillers: [{ jp: 'P', en: 'p' }, { jp: 'Q', en: 'q' }] },
            ],
        };
        const r = realizeTemplate(t2, { b: 1 }); // a defaults to 0
        expect(r.text).toBe('XとQ。');
        expect(r.mean).toBe('x and q.');
        expect(r.role).toBe('a:0,b:1');
    });
});

describe('plainText / rubyToSegments (server port)', () => {
    test('plainText strips ruby back to the base sentence', () => {
        expect(plainText('<ruby>歯<rt>は</rt></ruby>を<ruby>磨<rt>みが</rt></ruby>く。')).toBe('歯を磨く。');
        expect(plainText('もう plain。')).toBe('もう plain。');
    });

    test('rubyToSegments: concat(seg.t) === plainText(jp)', () => {
        const jp = '<ruby>歯<rt>は</rt></ruby>を<ruby>磨<rt>みが</rt></ruby>く。';
        expect(rubyToSegments(jp)).toEqual([{ t: '歯', r: 'は' }, { t: 'を' }, { t: '磨', r: 'みが' }, { t: 'く。' }]);
        expect(rubyToSegments(jp).map((s) => s.t).join('')).toBe(plainText(jp));
    });

    test('templatePickIndex clamps to [0, n-1] and defaults to 0', () => {
        const slot = { id: 's', label: 's', fillers: [{ jp: 'a', en: 'a' }, { jp: 'b', en: 'b' }, { jp: 'c', en: 'c' }] };
        expect(templatePickIndex(slot, { s: 1 })).toBe(1);
        expect(templatePickIndex(slot, { s: 99 })).toBe(2); // clamp high
        expect(templatePickIndex(slot, { s: -5 })).toBe(0); // clamp low
        expect(templatePickIndex(slot, {})).toBe(0); // default
        expect(templatePickIndex({ id: 'e', label: 'e', fillers: [] }, { e: 3 })).toBe(0); // no fillers → 0
    });
});
