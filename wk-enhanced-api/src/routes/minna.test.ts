// みんなの日本語 route — the Phase-3 lesson-annotation enrichment (enrichLessonAnnotations).
//
// The route handler itself is email-gated (covered by curl + the minnaGate); this exercises the pure
// enrichment: a lesson's grammar/example/conversation sentences are matched against the GATED Minna
// annotations in the store BY plainText hash and get `tokens` + `furigana` attached for tap-to-lookup.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { openDb, _useDbForTesting } from '../db/connection.ts';
import * as db from '../db/client.ts';
import { enrichLessonAnnotations } from './minna.ts';

let mem: ReturnType<typeof openDb>;
beforeEach(() => {
    mem = openDb(':memory:');
    _useDbForTesting(mem);
});
afterEach(() => {
    _useDbForTesting(null);
    mem.close();
});

describe('enrichLessonAnnotations (Phase 3 Minna tap-to-lookup)', () => {
    const seg = (text: string) => [{ t: text }];

    function seedLine(extId: string, text: string, tokens: db.AnnotationToken[], link: db.SentenceLink) {
        db.seedMinnaSentence({ extId, text, furigana: seg(text), translations: { en: 'x' }, link });
        const row = db.getMinnaSentenceByExtId(extId)!;
        db.upsertAnnotation({ sentenceId: row.id, tokens, bunsetsu: [], parser: 'test' });
    }

    test('attaches tokens + furigana to grammar / example / conversation sentences by hash', () => {
        seedLine('mnn-22-g0-0', 'べんきょうする', [{ i: 0, start: 0, end: 7, surface: 'べんきょうする', lemma: 'べんきょうする', pos: 'VERB', reading: '' }], { owner_type: 'grammar_point', owner_id: 'mnn-22-g0', ordinal: 0 });
        seedLine('mnn-22-ex-0', 'たべます', [{ i: 0, start: 0, end: 4, surface: 'たべます', lemma: 'たべる', pos: 'VERB', reading: '' }], { owner_type: 'lesson', owner_id: '22', ordinal: 0 });
        seedLine('mnn-22-conv-0', 'どんなへや', [{ i: 0, start: 0, end: 3, surface: 'どんな', lemma: 'どんな', pos: 'DET', reading: '' }], { owner_type: 'conversation', owner_id: 'mnn-22-conv', role: 'A', ordinal: 0 });

        const lesson = {
            grammar: [{ examples: [{ jp: 'べんきょうする', en: 'study' }] }],
            examples: [{ jp: 'たべます', en: 'eat' }],
            conversation: { lines: [{ role: 'A', jp: 'どんなへや', en: 'what room' }] },
        };
        const out = enrichLessonAnnotations(lesson);

        expect(out.grammar[0].examples[0].tokens[0].lemma).toBe('べんきょうする');
        expect(out.grammar[0].examples[0].furigana).toEqual(seg('べんきょうする'));
        expect(out.examples[0].tokens[0].lemma).toBe('たべる'); // merged lemma rides through
        expect(out.conversation.lines[0].tokens[0].surface).toBe('どんな');
    });

    test('a sentence with no matching annotation keeps plain ruby (fail-soft, no tokens added)', () => {
        seedLine('mnn-22-ex-0', 'たべます', [{ i: 0, start: 0, end: 4, surface: 'たべます', lemma: 'たべる', pos: 'VERB', reading: '' }], { owner_type: 'lesson', owner_id: '22', ordinal: 0 });
        const lesson = { examples: [{ jp: 'のみます', en: 'drink' }] }; // not seeded → no annotation
        const out = enrichLessonAnnotations(lesson);
        expect(out.examples[0].tokens).toBeUndefined();
    });

    test('no Minna annotations at all → lesson returned untouched', () => {
        const lesson = { examples: [{ jp: 'たべます', en: 'eat' }] };
        expect(enrichLessonAnnotations(lesson)).toBe(lesson); // same reference, no work done
    });
});
