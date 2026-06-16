// Unit test for the one bit of real logic in the curate-song orchestrator: the pure mapping from the
// analyzer output → the data/songs/<slug>.json seed shape. The analyze / align / seed steps are
// shell-outs / the live Claude call (integration-only), but this transform is where a wrong field
// would silently corrupt a seeded song, so it's pinned here.
import { test, expect } from 'bun:test';
import { analyzedToSeedFile } from './curate-song.ts';
import { segmentsToRuby } from '../../study-app/src/core/text.js';
import type { AnalyzedSong } from '../src/services/songAnalyze.ts';

test('analyzedToSeedFile: ruby jp, offset-less tokens, empty fields omitted', () => {
    const furigana = [{ t: '多分', r: 'たぶん' }, { t: ' ' }, { t: '私', r: 'わたし' }, { t: 'じゃなくていいね' }];
    const analyzed: AnalyzedSong = {
        profile: { jlpt: 'N3', grammarCount: 1, lineCount: 2 },
        lines: [
            {
                index: 0,
                text: '多分 私じゃなくていいね',
                furigana,
                en: "Maybe it doesn't have to be me",
                grammar: ['shi'],
                tokens: [
                    { i: 0, start: 0, end: 2, surface: '多分', lemma: '多分', pos: 'ADV', reading: 'たぶん', jlpt: 'N3', gloss: 'probably' },
                    { i: 1, start: 9, end: 11, surface: 'いい', lemma: 'いい', pos: 'ADJ', reading: 'いい', jlpt: 'N5', gloss: 'good' },
                ],
                flags: [],
            },
            // a furigana-flagged line (furigana dropped to null) with no en/grammar/tokens.
            { index: 1, text: 'らーめん', furigana: null, en: '', grammar: [], tokens: [], flags: ['furigana'] },
        ],
    };

    const seed = analyzedToSeedFile({ slug: 'dry-flower-yuuri', title: 'ドライフラワー', artist: '優里', youtubeId: 'abc123' }, analyzed);

    expect(seed.extId).toBe('song-dry-flower-yuuri');
    expect(seed).toMatchObject({ title: 'ドライフラワー', artist: '優里', youtubeId: 'abc123' });
    expect(seed.lines).toHaveLength(2);

    // line 0: jp is the ruby of the furigana (compared to segmentsToRuby, not a hardcoded string);
    // tokens keep surface/lemma/reading/pos/jlpt/gloss but DROP the computed offsets (seed recomputes).
    expect(seed.lines[0].jp).toBe(segmentsToRuby(furigana));
    expect(seed.lines[0].en).toBe("Maybe it doesn't have to be me");
    expect(seed.lines[0].grammar).toEqual(['shi']);
    expect(seed.lines[0].tokens).toEqual([
        { surface: '多分', lemma: '多分', reading: 'たぶん', pos: 'ADV', jlpt: 'N3', gloss: 'probably' },
        { surface: 'いい', lemma: 'いい', reading: 'いい', pos: 'ADJ', jlpt: 'N5', gloss: 'good' },
    ]);
    expect(JSON.stringify(seed.lines[0].tokens)).not.toContain('start');   // no offset leaked

    // line 1: furigana null → jp falls back to the plain line; empty en/grammar/tokens are omitted.
    expect(seed.lines[1].jp).toBe('らーめん');
    expect(seed.lines[1].en).toBeUndefined();
    expect(seed.lines[1].grammar).toBeUndefined();
    expect(seed.lines[1].tokens).toBeUndefined();
});

test('analyzedToSeedFile: artist/youtubeId default to null; empty song → empty lines', () => {
    const seed = analyzedToSeedFile({ slug: 's', title: 'T' }, { profile: { jlpt: null, grammarCount: 0, lineCount: 0 }, lines: [] });
    expect(seed.artist).toBeNull();
    expect(seed.youtubeId).toBeNull();
    expect(seed.lines).toEqual([]);
});
