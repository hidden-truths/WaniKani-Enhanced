// sentence_annotation repo — NLP enrichment. Two load-bearing properties: (1) the offset
// contract — every token's [start,end) reconstructs its surface under JS (UTF-16) slicing,
// enforced on write; (2) the READ rides the SAME privacy gate as getSentences, so a private
// sentence's annotation never leaks. The non-BMP + privacy tests below are BREACH/CONTRACT
// pins — if one breaks, fix the code, not the test.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { openDb, _useDbForTesting } from '../connection.ts';
import * as db from '../client.ts';

let mem: ReturnType<typeof openDb>;

beforeEach(() => {
    mem = openDb(':memory:');
    _useDbForTesting(mem);
});

afterEach(() => {
    _useDbForTesting(null);
    mem.close();
});

describe('sentence_annotation (NLP enrichment) — offset contract + privacy', () => {
    const seg = (text: string) => [{ t: text }];
    const n = (sql: string) => (mem.query(sql).get() as { n: number }).n;
    const idOf = (extId: string) => (mem.query('SELECT id FROM sentence WHERE ext_id = ?').get(extId) as { id: number }).id;
    // A token with all the boilerplate fields defaulted — tests only care about start/end/surface.
    const tok = (o: Partial<db.AnnotationToken> & { start: number; end: number; surface: string }): db.AnnotationToken => ({
        i: 0, lemma: '', pos: '', tag: '', reading: '', dep: '', head: 0, ...o,
    });
    const pub = (extId: string, text: string) =>
        db.upsertPublicSentence({ extId, text, furigana: seg(text), source: 'selftalk', translations: {}, tags: {}, link: { owner_type: 'selftalk' } });

    test('upsertAnnotation enforces the offset contract (slice === surface)', () => {
        pub('st-1', 'おはよう。'); // length 5
        const id = idOf('st-1');
        expect(() => db.upsertAnnotation({ sentenceId: id, tokens: [tok({ start: 0, end: 5, surface: 'おはよう。' })], bunsetsu: [], parser: 't' })).not.toThrow();
        // surface doesn't match the sliced span → rejected before any write
        expect(() => db.upsertAnnotation({ sentenceId: id, tokens: [tok({ start: 0, end: 3, surface: 'ちがう' })], bunsetsu: [], parser: 't' })).toThrow(/offset mismatch/);
    });

    test('CONTRACT PIN: offsets are UTF-16, not codepoint — proven across a non-BMP char', () => {
        // 𠮟 = U+20B9F, a surrogate pair: JS "𠮟".length === 2, so "𠮟る".length === 3.
        const text = '𠮟る';
        pub('st-x', text);
        const id = idOf('st-x');
        // correct UTF-16 offsets: 𠮟=[0,2), る=[2,3)
        expect(() => db.upsertAnnotation({ sentenceId: id, tokens: [tok({ i: 0, start: 0, end: 2, surface: '𠮟' }), tok({ i: 1, start: 2, end: 3, surface: 'る' })], bunsetsu: [], parser: 't' })).not.toThrow();
        // the CODEPOINT offsets a naive parser would emit (𠮟 at [0,1)) slice a lone surrogate → rejected
        expect(() => db.upsertAnnotation({ sentenceId: id, tokens: [tok({ i: 0, start: 0, end: 1, surface: '𠮟' })], bunsetsu: [], parser: 't' })).toThrow(/offset mismatch/);
    });

    test('PRIVACY PIN: a private row’s annotation is owner-only; public is anon-visible', () => {
        const a = db.createUser('a@x.com', 'h');
        const b = db.createUser('b@x.com', 'h');
        pub('st-pub', 'おはよう。');
        db.upsertAnnotation({ sentenceId: idOf('st-pub'), tokens: [tok({ start: 0, end: 5, surface: 'おはよう。' })], bunsetsu: [], parser: 't' });
        db.createSentence({ extId: 'usr-a1', text: 'ひみつ。', furigana: seg('ひみつ。'), source: 'selftalk', createdBy: a.id, translations: {}, tags: {}, link: { owner_type: 'selftalk' } });
        db.upsertAnnotation({ sentenceId: idOf('usr-a1'), tokens: [tok({ start: 0, end: 4, surface: 'ひみつ。' })], bunsetsu: [], parser: 't' });

        // public annotation: visible to anon + any user
        expect(db.getAnnotation({ extId: 'st-pub', viewer: null })).not.toBeNull();
        expect(db.getAnnotation({ extId: 'st-pub', viewer: b.id })).not.toBeNull();
        // private annotation: owner only — never anon, never another user, never the fail-closed default
        expect(db.getAnnotation({ extId: 'usr-a1', viewer: a.id })).not.toBeNull();
        expect(db.getAnnotation({ extId: 'usr-a1', viewer: b.id })).toBeNull();
        expect(db.getAnnotation({ extId: 'usr-a1', viewer: null })).toBeNull();
        expect(db.getAnnotation({ extId: 'usr-a1' })).toBeNull();
    });

    // The SERVING path (commit 3a): getSentences({includeAnnotations}) LEFT JOINs sentence_annotation
    // inside the VIEWER_VISIBLE gate. This pins that the join can't widen the gate — a private row's
    // annotation must never reach anon / another user — and that the flag is opt-in (no field without it).
    test('PRIVACY PIN: includeAnnotations join never leaks a private row’s annotation; opt-in only', () => {
        const a = db.createUser('a@x.com', 'h');
        const b = db.createUser('b@x.com', 'h');
        pub('st-pub', 'おはよう。'); // public selftalk + annotation
        db.upsertAnnotation({ sentenceId: idOf('st-pub'), tokens: [tok({ start: 0, end: 5, surface: 'おはよう。' })], bunsetsu: [], parser: 't' });
        db.createSentence({ extId: 'usr-a1', text: 'ひみつ。', furigana: seg('ひみつ。'), source: 'selftalk', createdBy: a.id, translations: {}, tags: {}, link: { owner_type: 'selftalk' } });
        db.upsertAnnotation({ sentenceId: idOf('usr-a1'), tokens: [tok({ start: 0, end: 4, surface: 'ひみつ。' })], bunsetsu: [], parser: 't' });

        // anon: only the public row, WITH its annotation; the private row is absent entirely
        const anon = db.getSentences({ ownerType: 'selftalk', viewer: null, includeAnnotations: true });
        expect(anon.map((s) => s.id)).toEqual(['st-pub']);
        expect(anon[0]!.annotation!.tokens.map((t) => t.surface)).toEqual(['おはよう。']);

        // owner A: both rows, each carrying its own annotation
        const owner = db.getSentences({ ownerType: 'selftalk', viewer: a.id, includeAnnotations: true });
        expect(owner.map((s) => s.id).sort()).toEqual(['st-pub', 'usr-a1']);
        expect(owner.find((s) => s.id === 'usr-a1')!.annotation!.tokens.map((t) => t.surface)).toEqual(['ひみつ。']);

        // another user B: A's private row + its annotation never appear (the breach we guard)
        expect(db.getSentences({ ownerType: 'selftalk', viewer: b.id, includeAnnotations: true }).map((s) => s.id)).toEqual(['st-pub']);

        // opt-in: without the flag, NO annotation field rides along even for a parsed row
        expect(db.getSentences({ ownerType: 'selftalk', viewer: a.id }).every((s) => s.annotation === undefined)).toBe(true);

        // a visible-but-unparsed row simply has no annotation field even WITH the flag (no existence leak)
        pub('st-bare', 'やあ。');
        const bare = db.getSentences({ ownerType: 'selftalk', viewer: null, includeAnnotations: true }).find((s) => s.id === 'st-bare')!;
        expect(bare.annotation).toBeUndefined();
    });

    test('upsertAnnotation is idempotent; getAnnotation round-trips tokens/bunsetsu/parser', () => {
        db.upsertPublicSentence({ extId: 'st-2', text: '母は。', furigana: [{ t: '母' }, { t: 'は。' }], source: 'selftalk', translations: {}, tags: {}, link: { owner_type: 'selftalk' } });
        const id = idOf('st-2');
        db.upsertAnnotation({ sentenceId: id, tokens: [tok({ i: 0, start: 0, end: 1, surface: '母', lemma: '母', pos: 'NOUN' })], bunsetsu: [{ start: 0, end: 1 }], parser: 'p1' });
        db.upsertAnnotation({ sentenceId: id, tokens: [tok({ i: 0, start: 0, end: 1, surface: '母' }), tok({ i: 1, start: 1, end: 2, surface: 'は' })], bunsetsu: [{ start: 0, end: 2 }], parser: 'p2' });
        expect(n('SELECT COUNT(*) AS n FROM sentence_annotation')).toBe(1); // replaced, not duplicated
        const ann = db.getAnnotation({ extId: 'st-2', viewer: null })!;
        expect(ann.parser).toBe('p2');
        expect(ann.tokens.map((t) => t.surface)).toEqual(['母', 'は']);
        expect(ann.bunsetsu).toEqual([{ start: 0, end: 2 }]);
        expect(ann.parsedAt).toBeGreaterThan(0);
    });

    test('getAnnotation returns null for an unknown ext_id and for a visible-but-unparsed sentence', () => {
        pub('st-none', 'やあ。');
        expect(db.getAnnotation({ extId: 'st-none', viewer: null })).toBeNull(); // visible, no annotation yet
        expect(db.getAnnotation({ extId: 'does-not-exist', viewer: null })).toBeNull();
    });

    test('annotation cascade-deletes with its sentence', () => {
        const a = db.createUser('c@x.com', 'h');
        db.createSentence({ extId: 'usr-c1', text: 'けす。', furigana: seg('けす。'), source: 'selftalk', createdBy: a.id, translations: {}, tags: {}, link: { owner_type: 'selftalk' } });
        db.upsertAnnotation({ sentenceId: idOf('usr-c1'), tokens: [tok({ start: 0, end: 3, surface: 'けす。' })], bunsetsu: [], parser: 't' });
        expect(db.getAnnotation({ extId: 'usr-c1', viewer: a.id })).not.toBeNull();
        db.deleteUserSentence({ extId: 'usr-c1', viewer: a.id });
        expect(n('SELECT COUNT(*) AS n FROM sentence_annotation')).toBe(0);
    });

    test('setGrammarTags replaces only grammar tags (preserves scene); idempotent; empty clears', () => {
        db.upsertPublicSentence({ extId: 'st-g', text: 'おはよう。', furigana: seg('おはよう。'), source: 'selftalk', translations: {}, tags: { scene: 'morning', grammar: ['old'] }, link: { owner_type: 'selftalk' } });
        const id = idOf('st-g');
        const tagsOf = () => db.getSentences({ ownerType: 'selftalk', viewer: null })[0]!.tags;

        db.setGrammarTags(id, ['te-iru', 'tai']);
        expect(tagsOf()).toEqual({ scene: 'morning', grammar: ['tai', 'te-iru'] }); // grammar value-sorted; scene preserved
        // replace wholesale (the 'old' + previous ids are gone, not merged)
        db.setGrammarTags(id, ['sou']);
        expect(tagsOf()).toEqual({ scene: 'morning', grammar: ['sou'] });
        expect(n("SELECT COUNT(*) AS n FROM sentence_tag WHERE kind='grammar'")).toBe(1);
        // empty clears grammar but leaves scene
        db.setGrammarTags(id, []);
        expect(tagsOf()).toEqual({ scene: 'morning' });
    });
});
