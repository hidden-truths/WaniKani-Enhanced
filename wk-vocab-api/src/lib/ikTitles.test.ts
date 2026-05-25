// IK title encoding is lossy — multiple original titles collapse to the same
// snake_case form. These tests document both the cases the heuristic gets
// right AND the dead-end cases it provably gets wrong, so a future "make it
// smarter" attempt is forced to update the failing-by-design expectations.
//
// The CLAUDE.md DEAD-END WARNINGS section lists these explicitly; this file
// is the executable form.

import { describe, test, expect } from 'bun:test';
import { ikTitleToFolder, prettifyTitle, resolveCategory, type IndexMeta } from './ikTitles.ts';

describe('ikTitleToFolder (heuristic, no map)', () => {
    test('simple multi-word title title-cases each token', () => {
        expect(ikTitleToFolder('fate_zero', null)).toBe('Fate Zero');
    });

    test('short joining words after the first stay lowercase', () => {
        // "la", "of", "the" etc. — common natural-English handling.
        expect(ikTitleToFolder('kill_la_kill', null)).toBe('Kill la Kill');
    });

    test('lone "x" becomes "×" (multiplication sign)', () => {
        expect(ikTitleToFolder('hunter_x_hunter', null)).toBe('Hunter × Hunter');
    });

    test('year suffix "__YYYY_" becomes " (YYYY)"', () => {
        expect(ikTitleToFolder('kanon__2006_', null)).toBe('Kanon (2006)');
    });

    test('null indexMeta is treated the same as missing entry', () => {
        expect(ikTitleToFolder('fate_zero', null)).toBe(
            ikTitleToFolder('fate_zero', {} as IndexMeta),
        );
    });
});

describe('ikTitleToFolder (map hit)', () => {
    test('map hit always wins over the heuristic', () => {
        const map: IndexMeta = {
            // Heuristic would produce "Kanon (2006)" — same answer here for
            // illustration. The point: even if the map said something weird,
            // it wins. We trust IK as the source of truth.
            'kanon__2006_': { title: 'Kanon (2006 Anime)', category: 'anime' },
        };
        expect(ikTitleToFolder('kanon__2006_', map)).toBe('Kanon (2006 Anime)');
    });

    test('falls back to heuristic when key is missing from the map', () => {
        const map: IndexMeta = {
            'something_else': { title: 'Something Else', category: 'anime' },
        };
        expect(ikTitleToFolder('fate_zero', map)).toBe('Fate Zero');
    });
});

describe('ikTitleToFolder (DEAD END: cases the heuristic gets wrong)', () => {
    // These are documented in CLAUDE.md. Pinning current (wrong) behavior so
    // we notice if anyone tries to "fix" the heuristic — the right fix is to
    // ensure the index_meta map has the entry, not to make the heuristic
    // smarter.

    test('"durarara__" → "Durarara" (loses the "!!" — actually "Durarara!!")', () => {
        // The trailing "_" gets dropped by the heuristic; IK's real title is
        // "Durarara!!" but we can't recover the "!" from the encoding.
        expect(ikTitleToFolder('durarara__', null)).toBe('Durarara');
    });

    test('"god_s_blessing_on_this_wonderful_world_" loses the trailing "!"', () => {
        // Real title: "God's Blessing on this Wonderful World!"
        // Heuristic produces something close but not identical.
        const got = ikTitleToFolder('god_s_blessing_on_this_wonderful_world_', null);
        // We don't pin the exact wrong string — just assert it's NOT the real one.
        expect(got).not.toBe("God's Blessing on this Wonderful World!");
    });
});

describe('prettifyTitle', () => {
    test('map hit wins (just like folder resolution)', () => {
        const map: IndexMeta = {
            'hunter_x_hunter': { title: 'Hunter × Hunter', category: 'anime' },
        };
        expect(prettifyTitle('hunter_x_hunter', map)).toBe('Hunter × Hunter');
    });

    test('without map: drops lone "x" tokens (degraded display)', () => {
        // The userscript drops "x" for display, on the theory it's most often
        // a separator like "Fate/Stay Night × Madoka". For "hunter_x_hunter"
        // this strips meaningful semantics — the map hit is what saves real users.
        // Pinning current behavior so the divergence from ikTitleToFolder
        // (which keeps "x" and renders it as "×") doesn't accidentally get unified.
        expect(prettifyTitle('hunter_x_hunter', null)).toBe('Hunter Hunter');
        // Compare with folder resolution which preserves the meaningful "×":
        // expect(ikTitleToFolder('hunter_x_hunter', null)).toBe('Hunter × Hunter');
    });

    test('without map: title-cases simple titles the same as ikTitleToFolder', () => {
        expect(prettifyTitle('fate_zero', null)).toBe('Fate Zero');
    });
});

describe('resolveCategory', () => {
    test('map hit returns the categorized category', () => {
        const map: IndexMeta = {
            'fate_zero': { title: 'Fate Zero', category: 'anime' },
        };
        expect(resolveCategory('fate_zero', undefined, map)).toBe('anime');
    });

    test('falls back to id prefix when not in map', () => {
        // IK example IDs start with the category: "anime_fate_zero_000123".
        expect(resolveCategory('fate_zero', 'anime_fate_zero_000123', null)).toBe('anime');
    });

    test('returns "unknown" when neither map nor id is available', () => {
        expect(resolveCategory('mystery', undefined, null)).toBe('unknown');
        expect(resolveCategory('mystery', undefined, {} as IndexMeta)).toBe('unknown');
    });

    test('map hit wins over id prefix when both are present', () => {
        const map: IndexMeta = {
            'something': { title: 'Something', category: 'drama' },
        };
        // If the map says drama but the id was minted as "anime_...", trust the map.
        expect(resolveCategory('something', 'anime_something_001', map)).toBe('drama');
    });
});
