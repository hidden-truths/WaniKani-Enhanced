// seed-annotations — the 歌/Songs backstop. The offline GiNZA artifact must NEVER overwrite a song
// line's RUNTIME LLM annotation (parser='llm', carrying the jlpt/gloss the study-app Mine UI reads).
// Upstream sentence-nlp/parse.py already filters source='song' rows out of the parse, so the committed
// annotations.json never carries a song hash — this pins the SEED-LAYER backstop for the case that
// filter is ever removed/changed and a song hash slips into the artifact. A CONTRACT pin: if it breaks,
// fix the guard in seed-annotations.ts, not the test.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { openDb, _useDbForTesting } from '../src/db/connection.ts';
import { ttsTextHash } from '../src/services/tts.ts';
import * as db from '../src/db/client.ts';
import { seedAnnotations, type Artifact } from './seed-annotations.ts';

let mem: ReturnType<typeof openDb>;

beforeEach(() => {
    mem = openDb(':memory:');
    _useDbForTesting(mem);
});

afterEach(() => {
    _useDbForTesting(null);
    mem.close();
});

// A token with the boilerplate fields defaulted — start/end/surface (+ any LLM jlpt/gloss extras) are
// what the assertions exercise.
const tok = (o: Partial<db.AnnotationToken> & { start: number; end: number; surface: string }): db.AnnotationToken => ({
    i: 0, lemma: '', pos: '', tag: '', reading: '', dep: '', head: 0, ...o,
});
const idOf = (extId: string) => (mem.query('SELECT id FROM sentence WHERE ext_id = ?').get(extId) as { id: number }).id;

describe('seed-annotations — never overwrite a song row’s LLM annotation', () => {
    test('a source=song hash is skipped (jlpt/gloss preserved); a source=example row still seeds', () => {
        // A PUBLIC 歌/Songs line — getPublicSentenceByHash only resolves public+visible rows, and the
        // starter songs are public, so this is the row the seed would actually collide with. It carries
        // the runtime LLM annotation: tokens have jlpt + gloss the GiNZA batch never produces.
        const songText = 'ねこがすき';
        db.upsertPublicSentence({ extId: 'song-x-l0', text: songText, source: 'song', translations: {}, tags: {}, link: { owner_type: 'song', ordinal: 0 } });
        db.upsertAnnotation({
            sentenceId: idOf('song-x-l0'),
            tokens: [tok({ i: 0, start: 0, end: 2, surface: 'ねこ', lemma: 'ねこ', pos: 'NOUN', reading: 'ねこ', jlpt: 'N5', gloss: 'cat' })],
            bunsetsu: [{ start: 0, end: 5 }],
            parser: 'llm:claude-opus-4-8',
        });

        // A normal GiNZA-owned example row that SHOULD be seeded — proves the guard is selective, not a
        // blanket "skip every annotation".
        const exText = 'ほんをよむ';
        db.upsertPublicSentence({ extId: 'ex-readbook', text: exText, source: 'example', translations: {}, tags: {}, link: { owner_type: 'card', owner_id: '1', tier: 'N5' } });

        const ginzaParser = 'ja_ginza_electra/5.2.0 splitC+merge';
        const artifact: Artifact = {
            parser: ginzaParser,
            annotations: [
                {
                    // Same hash as the song row → would collide. GiNZA tokens carry NO jlpt/gloss, so an
                    // overwrite here would silently drop those fields.
                    hash: ttsTextHash(songText),
                    ext_id: 'song-x-l0',
                    text: songText,
                    tokens: [tok({ i: 0, start: 0, end: 2, surface: 'ねこ', lemma: 'ねこ', pos: 'NOUN' })],
                    bunsetsu: [{ start: 0, end: 5 }],
                    grammar: ['ga'],
                },
                {
                    hash: ttsTextHash(exText),
                    ext_id: 'ex-readbook',
                    text: exText,
                    tokens: [tok({ i: 0, start: 0, end: 5, surface: exText, lemma: exText, pos: 'NOUN' })],
                    bunsetsu: [{ start: 0, end: 5 }],
                    grammar: ['wo'],
                },
            ],
        };

        const r = seedAnnotations(artifact);

        // The song annotation was skipped, the example was seeded; nothing miscounted as missing/stale.
        expect(r.skippedSong).toBe(1);
        expect(r.seeded).toBe(1);
        expect(r.missing).toBe(0);
        expect(r.stale).toBe(0);

        // The song's LLM annotation is UNTOUCHED — parser still 'llm:*', and jlpt/gloss survive.
        const songAnn = db.getAnnotation({ extId: 'song-x-l0', viewer: null })!;
        expect(songAnn.parser).toBe('llm:claude-opus-4-8');
        expect(songAnn.tokens[0]!.jlpt).toBe('N5');
        expect(songAnn.tokens[0]!.gloss).toBe('cat');

        // The example row DID receive the GiNZA annotation + its grammar tag (selective, as intended).
        const exAnn = db.getAnnotation({ extId: 'ex-readbook', viewer: null })!;
        expect(exAnn.parser).toBe(ginzaParser);
        expect(exAnn.tokens[0]!.jlpt).toBeUndefined();
        expect(db.getSentences({ ownerType: 'card', ownerId: '1', viewer: null })[0]!.tags.grammar).toEqual(['wo']);
    });
});
