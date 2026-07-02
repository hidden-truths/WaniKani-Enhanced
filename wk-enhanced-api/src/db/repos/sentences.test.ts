// sentence store repo — the privacy choke-point + user CRUD + curator/example seed paths.
//
// The privacy filter (getSentences) is the single gate the whole Self-Talk feature's
// privacy rests on; the first three describe blocks are BREACH-PREVENTION pins (à la the
// ikTitles dead-end pins), not nice-to-haves. If one breaks, a private user sentence is
// about to leak — do not "fix" the test, fix the leak. The last block is direct unit
// coverage for the building blocks the seed/reuse paths exercise only indirectly.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { openDb, _useDbForTesting } from '../connection.ts';
import * as db from '../client.ts';
import { ttsTextHash } from '../../services/tts.ts';

let mem: ReturnType<typeof openDb>;

beforeEach(() => {
    mem = openDb(':memory:');
    _useDbForTesting(mem);
});

afterEach(() => {
    _useDbForTesting(null);
    mem.close();
});

describe('sentence store privacy + ownership pins', () => {
    // Trivial all-kana furigana (one segment) for texts with no kanji — keeps the
    // concat(seg.t) === text invariant satisfied without hand-writing ruby per test.
    const seg = (text: string) => [{ t: text }];

    test('getSentences({viewer:null}) returns only public rows; private rows are hidden', () => {
        const a = db.createUser('a@x.com', 'h');
        db.upsertPublicSentence({ extId: 'st-1', text: 'おはよう。', furigana: seg('おはよう。'), source: 'selftalk', translations: { en: 'morning' }, tags: { scene: 'morning', grammar: ['te-iru'] }, link: { owner_type: 'selftalk' } });
        db.createSentence({ extId: 'usr-a1', text: 'わたしのぶん。', furigana: seg('わたしのぶん。'), source: 'selftalk', createdBy: a.id, translations: { en: 'mine' }, tags: { scene: 'work', grammar: ['tai'] }, link: { owner_type: 'selftalk' } });
        const anon = db.getSentences({ ownerType: 'selftalk', viewer: null });
        expect(anon.map((s) => s.id)).toEqual(['st-1']);
        expect(anon.every((s) => s.custom === false)).toBe(true);
    });

    test('a private row is visible to its owner, invisible to another user and to anon', () => {
        const a = db.createUser('a@x.com', 'h');
        const b = db.createUser('b@x.com', 'h');
        db.createSentence({ extId: 'usr-a1', text: 'ひみつ。', furigana: seg('ひみつ。'), source: 'selftalk', createdBy: a.id, translations: { en: 'secret' }, tags: { scene: 'work', grammar: ['tai'] }, link: { owner_type: 'selftalk' } });
        expect(db.getSentences({ ownerType: 'selftalk', viewer: a.id }).map((s) => s.id)).toEqual(['usr-a1']);
        expect(db.getSentences({ ownerType: 'selftalk', viewer: b.id })).toEqual([]);
        expect(db.getSentences({ ownerType: 'selftalk', viewer: null })).toEqual([]);
    });

    test('a viewer sees public + own private together (custom flag distinguishes them)', () => {
        const a = db.createUser('a@x.com', 'h');
        db.upsertPublicSentence({ extId: 'st-1', text: 'こんにちは。', furigana: seg('こんにちは。'), source: 'selftalk', translations: { en: 'hi' }, tags: { scene: 'morning', grammar: ['te-iru'] }, link: { owner_type: 'selftalk' } });
        db.createSentence({ extId: 'usr-a1', text: 'じぶんの。', furigana: seg('じぶんの。'), source: 'selftalk', createdBy: a.id, translations: { en: 'own' }, tags: { scene: 'work', grammar: ['tai'] }, link: { owner_type: 'selftalk' } });
        const seen = db.getSentences({ ownerType: 'selftalk', viewer: a.id });
        expect(seen.map((s) => s.id).sort()).toEqual(['st-1', 'usr-a1']);
        expect(new Map(seen.map((s) => [s.id, s.custom]))).toEqual(new Map([['st-1', false], ['usr-a1', true]]));
    });

    test('the public_sentence VIEW excludes a private row and a gated (public=0) row', () => {
        const a = db.createUser('a@x.com', 'h');
        db.upsertPublicSentence({ extId: 'st-1', text: 'おはよう。', furigana: seg('おはよう。'), source: 'selftalk', translations: { en: 'm' }, tags: {}, link: { owner_type: 'selftalk' } });
        db.createSentence({ extId: 'usr-a1', text: 'ひみつ。', furigana: seg('ひみつ。'), source: 'selftalk', createdBy: a.id, translations: {}, tags: {}, link: { owner_type: 'selftalk' } });
        // A gated row: public=0 but visibility='public' (the Minna copyright slice). No repo fn
        // creates one, so insert raw to prove the VIEW still excludes it (anon/export read this VIEW).
        mem.query(`INSERT INTO sentence (ext_id, hash, text, source, public, visibility, created_at) VALUES ('gated', 'h', 'x', 'minna', 0, 'public', 1)`).run();
        const view = (mem.query('SELECT ext_id FROM public_sentence ORDER BY ext_id').all() as { ext_id: string }[]).map((r) => r.ext_id);
        expect(view).toEqual(['st-1']);
    });

    test('upsertPublicSentence is idempotent — re-seed does not duplicate rows/links/tags', () => {
        const payload = { extId: 'st-1', text: 'おはよう。', furigana: seg('おはよう。'), source: 'selftalk', translations: { en: 'morning' }, tags: { scene: 'morning', grammar: ['te-iru', 'tai'] }, link: { owner_type: 'selftalk' } };
        db.upsertPublicSentence(payload);
        db.upsertPublicSentence(payload); // second run must not grow anything
        const n = (sql: string) => (mem.query(sql).get() as { n: number }).n;
        expect(n('SELECT COUNT(*) AS n FROM sentence')).toBe(1);
        expect(n('SELECT COUNT(*) AS n FROM translation')).toBe(1);
        expect(n('SELECT COUNT(*) AS n FROM sentence_tag')).toBe(3);
        expect(n('SELECT COUNT(*) AS n FROM sentence_link')).toBe(1);
        const got = db.getSentences({ ownerType: 'selftalk', viewer: null });
        expect(got[0]!.tags).toEqual({ scene: 'morning', grammar: ['tai', 'te-iru'] }); // grammar comes back value-sorted (no ordinal column)
        expect(got[0]!.translations).toEqual({ en: 'morning' });
    });

    test('update/delete by a non-owner affects 0 rows; the owner can mutate', () => {
        const a = db.createUser('a@x.com', 'h');
        const b = db.createUser('b@x.com', 'h');
        db.createSentence({ extId: 'usr-a1', text: 'もとの。', furigana: seg('もとの。'), source: 'selftalk', createdBy: a.id, translations: { en: 'orig' }, tags: { scene: 'work', grammar: ['tai'] }, link: { owner_type: 'selftalk' } });
        // B cannot touch A's row.
        expect(db.updateUserSentence({ extId: 'usr-a1', viewer: b.id, text: 'のっとり。', furigana: seg('のっとり。'), translations: { en: 'hijack' }, tags: { scene: 'work', grammar: ['tai'] }, link: { owner_type: 'selftalk' } })).toBeNull();
        expect(db.deleteUserSentence({ extId: 'usr-a1', viewer: b.id })).toBe(false);
        expect(db.getSentences({ ownerType: 'selftalk', viewer: a.id })[0]!.text).toBe('もとの。');
        // A can.
        const upd = db.updateUserSentence({ extId: 'usr-a1', viewer: a.id, text: 'あたらしい。', furigana: seg('あたらしい。'), translations: { en: 'new' }, tags: { scene: 'meals', grammar: ['sou'] }, link: { owner_type: 'selftalk' } });
        expect(upd!.text).toBe('あたらしい。');
        expect(upd!.tags).toEqual({ scene: 'meals', grammar: ['sou'] });
        expect(db.deleteUserSentence({ extId: 'usr-a1', viewer: a.id })).toBe(true);
        expect(db.getSentences({ ownerType: 'selftalk', viewer: a.id })).toEqual([]);
    });

    test('write rejects furigana that does not reconstruct text', () => {
        const a = db.createUser('a@x.com', 'h');
        expect(() => db.createSentence({ extId: 'usr-bad', text: 'ほんとう。', furigana: [{ t: 'ちがう' }], source: 'selftalk', createdBy: a.id, translations: { en: 'x' }, tags: {}, link: { owner_type: 'selftalk' } })).toThrow();
    });

    test('stored hash equals ttsTextHash(text) — the audio-layer key, computed server-side', () => {
        const a = db.createUser('a@x.com', 'h');
        db.createSentence({ extId: 'usr-a1', text: 'はをみがく。', furigana: [{ t: 'は' }, { t: 'を' }, { t: 'みがく。' }], source: 'selftalk', createdBy: a.id, translations: { en: 'brush' }, tags: {}, link: { owner_type: 'selftalk' } });
        const row = mem.query('SELECT hash FROM sentence WHERE ext_id = ?').get('usr-a1') as { hash: string };
        expect(row.hash).toBe(ttsTextHash('はをみがく。'));
    });

    test('a private row may share a hash with a public row (no global UNIQUE(hash))', () => {
        const a = db.createUser('a@x.com', 'h');
        db.upsertPublicSentence({ extId: 'st-dup', text: 'おはよう。', furigana: seg('おはよう。'), source: 'selftalk', translations: {}, tags: {}, link: { owner_type: 'selftalk' } });
        // Same text → same hash, but a private row is allowed to collide (partial unique only
        // covers public+public-visibility). This must NOT throw.
        expect(() => db.createSentence({ extId: 'usr-dup', text: 'おはよう。', furigana: seg('おはよう。'), source: 'selftalk', createdBy: a.id, translations: {}, tags: {}, link: { owner_type: 'selftalk' } })).not.toThrow();
    });
});

// Phase 2: built-in vocab EXAMPLE sentences are PUBLIC rows linked to cards (owner_type='card',
// owner_id=<rank>, tier='N5'..'N1'). The read returns one entry PER LINK so a reused sentence
// reports every (card, tier) it covers; the seed reuses by hash so identical text is one row +
// many links (never a duplicate that would violate the partial unique hash index).
describe('sentence store — card examples (per-link read + reuse)', () => {
    const seg = (text: string) => [{ t: text }];
    const n = (sql: string) => (mem.query(sql).get() as { n: number }).n;

    test('getSentences({ownerType:card}) returns one entry PER LINK with owner_id + tier', () => {
        db.seedExampleSentence({ text: 'いぬ。', furigana: seg('いぬ。'), translations: { en: 'a dog' }, cardLinks: [{ owner_type: 'card', owner_id: '1', tier: 'N5' }] });
        db.seedExampleSentence({ text: 'ねこ。', furigana: seg('ねこ。'), translations: { en: 'a cat' }, cardLinks: [{ owner_type: 'card', owner_id: '1', tier: 'N4' }] });
        const anon = db.getSentences({ ownerType: 'card', viewer: null });
        expect(anon.map((s) => [s.link.owner_id, s.link.tier, s.text])).toEqual([
            ['1', 'N5', 'いぬ。'],
            ['1', 'N4', 'ねこ。'],
        ]);
        expect(anon.every((s) => s.custom === false)).toBe(true);
    });

    test('ownerId narrows the read to one card', () => {
        db.seedExampleSentence({ text: 'いぬ。', furigana: seg('いぬ。'), translations: { en: 'dog' }, cardLinks: [{ owner_type: 'card', owner_id: '1', tier: 'N5' }] });
        db.seedExampleSentence({ text: 'とり。', furigana: seg('とり。'), translations: { en: 'bird' }, cardLinks: [{ owner_type: 'card', owner_id: '2', tier: 'N5' }] });
        const r1 = db.getSentences({ ownerType: 'card', ownerId: '1', viewer: null });
        expect(r1.map((s) => s.link.owner_id)).toEqual(['1']);
    });

    test('reuse (example↔example): identical text shared by two cards/tiers = ONE row + TWO links', () => {
        db.seedExampleSentence({
            text: 'はしる。',
            furigana: seg('はしる。'),
            translations: { en: 'run' },
            cardLinks: [
                { owner_type: 'card', owner_id: '1', tier: 'N5' },
                { owner_type: 'card', owner_id: '2', tier: 'N3' },
            ],
        });
        expect(n('SELECT COUNT(*) AS n FROM sentence')).toBe(1);
        expect(n("SELECT COUNT(*) AS n FROM sentence_link WHERE owner_type='card'")).toBe(2);
        const read = db.getSentences({ ownerType: 'card', viewer: null });
        expect(read.map((s) => [s.link.owner_id, s.link.tier])).toEqual([
            ['1', 'N5'],
            ['2', 'N3'],
        ]);
    });

    test('reuse (example↔selftalk): an example matching a Self-Talk public row reuses it, untouched', () => {
        // A Self-Talk public row exists first; an example with identical text must NOT insert a
        // second public row (it would violate ux_sentence_public_hash) — it reuses the row.
        db.upsertPublicSentence({ extId: 'st-1', text: 'おはよう。', furigana: seg('おはよう。'), source: 'selftalk', translations: { en: 'good morning' }, tags: { scene: 'morning' }, link: { owner_type: 'selftalk' } });
        db.seedExampleSentence({ text: 'おはよう。', furigana: seg('おはよう。'), translations: { en: 'IGNORED for a foreign row' }, cardLinks: [{ owner_type: 'card', owner_id: '5', tier: 'N5' }] });
        expect(n('SELECT COUNT(*) AS n FROM sentence')).toBe(1);
        // The selftalk read still sees it once (its selftalk link), translations untouched.
        const st = db.getSentences({ ownerType: 'selftalk', viewer: null });
        expect(st.map((s) => [s.id, s.translations.en])).toEqual([['st-1', 'good morning']]);
        // The card read sees it once (its card link).
        const card = db.getSentences({ ownerType: 'card', viewer: null });
        expect(card.map((s) => [s.id, s.link.owner_id, s.link.tier])).toEqual([['st-1', '5', 'N5']]);
    });

    test('seedExampleSentence is idempotent — re-seed does not grow rows/links/translations', () => {
        const payload = { text: 'はしる。', furigana: seg('はしる。'), translations: { en: 'run' }, cardLinks: [{ owner_type: 'card', owner_id: '1', tier: 'N5' }, { owner_type: 'card', owner_id: '2', tier: 'N3' }] };
        db.seedExampleSentence(payload);
        db.seedExampleSentence(payload);
        expect(n('SELECT COUNT(*) AS n FROM sentence')).toBe(1);
        expect(n("SELECT COUNT(*) AS n FROM sentence_link WHERE owner_type='card'")).toBe(2);
        expect(n('SELECT COUNT(*) AS n FROM translation')).toBe(1);
        // A re-seed of OUR example row refreshes its translation (bundle fix propagates).
        db.seedExampleSentence({ ...payload, translations: { en: 'to run (fixed)' } });
        expect(db.getSentences({ ownerType: 'card', ownerId: '1', viewer: null })[0]!.translations).toEqual({ en: 'to run (fixed)' });
        expect(n('SELECT COUNT(*) AS n FROM translation')).toBe(1);
    });

    test('privacy still holds: a gated (public=0) card-linked row is invisible to anon + the VIEW', () => {
        // No repo fn creates a gated card row; insert one raw to prove the mechanism (per-link read
        // still ANDs the public/owner gate, and the export VIEW excludes it).
        mem.query(`INSERT INTO sentence (ext_id, hash, text, source, public, visibility, created_at) VALUES ('ex-gated', 'h', 'x', 'example', 0, 'public', 1)`).run();
        const gid = (mem.query("SELECT id FROM sentence WHERE ext_id='ex-gated'").get() as { id: number }).id;
        mem.query(`INSERT INTO sentence_link (sentence_id, owner_type, owner_id, tier, ordinal) VALUES (?, 'card', '9', 'N5', 0)`).run(gid);
        expect(db.getSentences({ ownerType: 'card', viewer: null })).toEqual([]);
        expect(n('SELECT COUNT(*) AS n FROM public_sentence')).toBe(0);
    });
});

// Phase 2.5: a custom card's examples (single `ex` + JLPT `levels` tiers) become PRIVATE store
// rows via a wholesale replace, so they render like built-in examples (GET ownerType=card returns
// the caller's own private rows) but stay owner-scoped. The replace is scoped to created_by=viewer,
// so it can NEVER delete a public built-in example — a breach-prevention pin, not a nice-to-have.
describe('replaceUserCardExamples (custom-card examples → private store)', () => {
    const seg = (text: string) => [{ t: text }];
    const n = (sql: string) => (mem.query(sql).get() as { n: number }).n;

    test('writes private card rows the owner reads; hidden from anon + other users', () => {
        const a = db.createUser('a@x.com', 'h');
        const b = db.createUser('b@x.com', 'h');
        db.replaceUserCardExamples({ rank: '101', viewer: a.id, examples: [
            { slot: 'ex', text: 'はしる。', furigana: seg('はしる。'), en: 'run' },
            { slot: 'N5', text: 'まいあさはしる。', furigana: seg('まいあさはしる。'), en: 'run every morning' },
        ] });
        const own = db.getSentences({ ownerType: 'card', ownerId: '101', viewer: a.id });
        expect(own.map((s) => [s.link.owner_id, s.link.tier ?? null, s.text, s.translations.en, s.custom])).toEqual([
            ['101', null, 'はしる。', 'run', true],                          // 'ex' → untiered (tier omitted)
            ['101', 'N5', 'まいあさはしる。', 'run every morning', true],
        ]);
        expect(db.getSentences({ ownerType: 'card', ownerId: '101', viewer: b.id })).toEqual([]); // not B's
        expect(db.getSentences({ ownerType: 'card', ownerId: '101', viewer: null })).toEqual([]); // not anon's
        expect(n('SELECT COUNT(*) AS n FROM public_sentence')).toBe(0);                            // never public
    });

    test('replace is wholesale — a removed tier drops its row; empty clears the card', () => {
        const a = db.createUser('a@x.com', 'h');
        db.replaceUserCardExamples({ rank: '101', viewer: a.id, examples: [
            { slot: 'N5', text: 'あ。', furigana: seg('あ。') },
            { slot: 'N4', text: 'い。', furigana: seg('い。') },
        ] });
        // Re-replace with only N5 → the N4 row is gone (no orphan).
        db.replaceUserCardExamples({ rank: '101', viewer: a.id, examples: [{ slot: 'N5', text: 'あ2。', furigana: seg('あ2。') }] });
        expect(db.getSentences({ ownerType: 'card', ownerId: '101', viewer: a.id }).map((s) => [s.link.tier, s.text])).toEqual([['N5', 'あ2。']]);
        // Empty clears it entirely (used on card delete); children cascade, no orphans.
        db.replaceUserCardExamples({ rank: '101', viewer: a.id, examples: [] });
        expect(db.getSentences({ ownerType: 'card', ownerId: '101', viewer: a.id })).toEqual([]);
        expect(n('SELECT COUNT(*) AS n FROM sentence')).toBe(0);
    });

    test('scoped to created_by=viewer — a replace never deletes a PUBLIC example at the same owner_id', () => {
        const a = db.createUser('a@x.com', 'h');
        db.seedExampleSentence({ text: 'こうかい。', furigana: seg('こうかい。'), translations: { en: 'public' }, cardLinks: [{ owner_type: 'card', owner_id: '101', tier: 'N5' }] });
        db.replaceUserCardExamples({ rank: '101', viewer: a.id, examples: [{ slot: 'N5', text: 'しよう。', furigana: seg('しよう。') }] });
        expect(db.getSentences({ ownerType: 'card', ownerId: '101', viewer: null }).map((s) => s.text)).toEqual(['こうかい。']); // public survives
        expect(db.getSentences({ ownerType: 'card', ownerId: '101', viewer: a.id }).map((s) => s.text).sort()).toEqual(['こうかい。', 'しよう。']);
    });

    test('ext_id is user-scoped — two accounts with the same rank do not collide', () => {
        const a = db.createUser('a@x.com', 'h');
        const b = db.createUser('b@x.com', 'h');
        db.replaceUserCardExamples({ rank: '101', viewer: a.id, examples: [{ slot: 'N5', text: 'えー。', furigana: seg('えー。') }] });
        expect(() => db.replaceUserCardExamples({ rank: '101', viewer: b.id, examples: [{ slot: 'N5', text: 'びー。', furigana: seg('びー。') }] })).not.toThrow();
        expect(db.getSentences({ ownerType: 'card', ownerId: '101', viewer: a.id }).map((s) => s.text)).toEqual(['えー。']);
        expect(db.getSentences({ ownerType: 'card', ownerId: '101', viewer: b.id }).map((s) => s.text)).toEqual(['びー。']);
    });

    test('a bad-furigana slot aborts the whole replace (pre-validated, no partial write)', () => {
        const a = db.createUser('a@x.com', 'h');
        db.replaceUserCardExamples({ rank: '101', viewer: a.id, examples: [{ slot: 'N5', text: 'ある。', furigana: seg('ある。') }] });
        expect(() => db.replaceUserCardExamples({ rank: '101', viewer: a.id, examples: [
            { slot: 'N5', text: 'よい。', furigana: seg('よい。') },
            { slot: 'N4', text: 'だめ。', furigana: [{ t: 'ちがう' }] }, // furigana ≠ text → throws before any mutation
        ] })).toThrow();
        expect(db.getSentences({ ownerType: 'card', ownerId: '101', viewer: a.id }).map((s) => s.text)).toEqual(['ある。']); // prior set intact
    });
});

// Direct unit coverage for sentence-store building blocks the moved suites exercise only
// indirectly: the per-user count, the owner-scoped single fetch, and the reuse-by-hash
// primitives (getPublicSentenceByHash / upsertPublicSentenceByHash) behind seedExampleSentence
// and materializeTemplateRealization.
describe('sentence store — countUserSentences / getUserSentence / reuse-by-hash', () => {
    const seg = (text: string) => [{ t: text }];
    const n = (sql: string) => (mem.query(sql).get() as { n: number }).n;

    test('countUserSentences counts only the viewer’s own private rows (never public)', () => {
        const a = db.createUser('a@x.com', 'h');
        const b = db.createUser('b@x.com', 'h');
        expect(db.countUserSentences(a.id)).toBe(0);
        db.createSentence({ extId: 'usr-a1', text: 'いち。', furigana: seg('いち。'), source: 'selftalk', createdBy: a.id, translations: {}, tags: {}, link: { owner_type: 'selftalk' } });
        db.createSentence({ extId: 'usr-a2', text: 'に。', furigana: seg('に。'), source: 'selftalk', createdBy: a.id, translations: {}, tags: {}, link: { owner_type: 'selftalk' } });
        db.createSentence({ extId: 'usr-b1', text: 'さん。', furigana: seg('さん。'), source: 'selftalk', createdBy: b.id, translations: {}, tags: {}, link: { owner_type: 'selftalk' } });
        db.upsertPublicSentence({ extId: 'st-1', text: 'おはよう。', furigana: seg('おはよう。'), source: 'selftalk', translations: {}, tags: {}, link: { owner_type: 'selftalk' } });
        expect(db.countUserSentences(a.id)).toBe(2);
        expect(db.countUserSentences(b.id)).toBe(1);
    });

    test('getUserSentence returns the owner’s assembled row; null for a miss / non-owner / public', () => {
        const a = db.createUser('a@x.com', 'h');
        const b = db.createUser('b@x.com', 'h');
        db.createSentence({ extId: 'usr-a1', text: 'やる。', furigana: seg('やる。'), source: 'selftalk', createdBy: a.id, translations: { en: 'do' }, tags: { scene: 'work' }, link: { owner_type: 'selftalk' } });
        const got = db.getUserSentence({ extId: 'usr-a1', viewer: a.id });
        expect(got).not.toBeNull();
        expect(got!.text).toBe('やる。');
        expect(got!.translations).toEqual({ en: 'do' });
        expect(got!.custom).toBe(true);
        // not the owner → null (even though the row exists); unknown ext_id → null
        expect(db.getUserSentence({ extId: 'usr-a1', viewer: b.id })).toBeNull();
        expect(db.getUserSentence({ extId: 'nope', viewer: a.id })).toBeNull();
        // a PUBLIC row is not "a user's own" (created_by is NULL) → null
        db.upsertPublicSentence({ extId: 'st-1', text: 'こんにちは。', furigana: seg('こんにちは。'), source: 'selftalk', translations: {}, tags: {}, link: { owner_type: 'selftalk' } });
        expect(db.getUserSentence({ extId: 'st-1', viewer: a.id })).toBeNull();
    });

    test('getPublicSentenceByHash finds the public row by content hash; null for private / missing', () => {
        const a = db.createUser('a@x.com', 'h');
        db.upsertPublicSentence({ extId: 'st-1', text: 'おはよう。', furigana: seg('おはよう。'), source: 'selftalk', translations: {}, tags: {}, link: { owner_type: 'selftalk' } });
        expect(db.getPublicSentenceByHash(ttsTextHash('おはよう。'))!.ext_id).toBe('st-1');
        expect(db.getPublicSentenceByHash(ttsTextHash('missing'))).toBeNull();
        // a PRIVATE row with a unique hash is NOT in the public slice
        db.createSentence({ extId: 'usr-a1', text: 'ひみつ。', furigana: seg('ひみつ。'), source: 'selftalk', createdBy: a.id, translations: {}, tags: {}, link: { owner_type: 'selftalk' } });
        expect(db.getPublicSentenceByHash(ttsTextHash('ひみつ。'))).toBeNull();
    });

    test('upsertPublicSentenceByHash inserts once, reuses by hash (owned refresh vs foreign untouched)', () => {
        // first call inserts + reports owned, with a deterministic ext_id `${prefix}-${hash}`
        const first = db.upsertPublicSentenceByHash({ source: 'template', extIdPrefix: 'tpl', text: 'いえにかえる。', furigana: seg('いえにかえる。'), translations: { en: 'go home' } });
        expect(first.owned).toBe(true);
        expect(n('SELECT COUNT(*) AS n FROM sentence')).toBe(1);
        const row = mem.query('SELECT ext_id, source FROM sentence WHERE id = ?').get(first.id) as { ext_id: string; source: string };
        expect(row.ext_id).toBe('tpl-' + ttsTextHash('いえにかえる。'));
        expect(row.source).toBe('template');

        // same text + same source → reuse the SAME row (owned), refresh translations, no growth
        const again = db.upsertPublicSentenceByHash({ source: 'template', extIdPrefix: 'tpl', text: 'いえにかえる。', furigana: seg('いえにかえる。'), translations: { en: 'head home' } });
        expect(again).toEqual({ id: first.id, owned: true });
        expect(n('SELECT COUNT(*) AS n FROM sentence')).toBe(1);
        expect(n('SELECT COUNT(*) AS n FROM translation')).toBe(1);
        expect((mem.query('SELECT text FROM translation WHERE sentence_id = ?').get(first.id) as { text: string }).text).toBe('head home');

        // same text + DIFFERENT source → reuse the row but report NOT owned + leave it untouched
        const foreign = db.upsertPublicSentenceByHash({ source: 'example', extIdPrefix: 'ex', text: 'いえにかえる。', furigana: seg('いえにかえる。'), translations: { en: 'IGNORED' } });
        expect(foreign).toEqual({ id: first.id, owned: false });
        expect((mem.query('SELECT text FROM translation WHERE sentence_id = ?').get(first.id) as { text: string }).text).toBe('head home'); // untouched
    });

    test('upsertPublicSentenceByHash rejects furigana that does not reconstruct text', () => {
        expect(() => db.upsertPublicSentenceByHash({ source: 'template', extIdPrefix: 'tpl', text: 'ほんとう。', furigana: [{ t: 'ちがう' }] })).toThrow();
    });
});

describe('みんなの日本語 (Minna) gated sentences — Phase 3', () => {
    const seg = (text: string) => [{ t: text }];
    const gLink = { owner_type: 'grammar_point', owner_id: 'mnn-22-g0', ordinal: 0 };

    // BREACH PIN: Minna is copyright-gated curator content (public=0, created_by=NULL). It must be
    // DARK to the generic getSentences gate — even when queried under the exact owner_type it's linked
    // under — so a bug in any sentence-store read path can never leak the textbook material. Only the
    // email-gated /v1/minna route (getMinnaAnnotations) may reach it. If this breaks, fix the leak.
    test('BREACH PIN: a Minna gated row is dark to getSentences for anon AND any viewer', () => {
        const u = db.createUser('m@x.com', 'h');
        db.seedMinnaSentence({ extId: 'mnn-22-g0-0', text: 'これは ほんです。', furigana: seg('これは ほんです。'), translations: { en: 'This is a book.' }, link: gLink });
        for (const ownerType of ['grammar_point', 'lesson', 'conversation', 'selftalk', 'card']) {
            expect(db.getSentences({ ownerType, viewer: null })).toEqual([]);
            expect(db.getSentences({ ownerType, viewer: u.id })).toEqual([]);
        }
        expect((mem.query("SELECT COUNT(*) AS n FROM public_sentence WHERE source='minna'").get() as { n: number }).n).toBe(0);
    });

    test('getMinnaSentenceByExtId + getMinnaAnnotations reach the gated row (the /v1/minna serve path)', () => {
        db.seedMinnaSentence({ extId: 'mnn-22-conv-0', text: 'どんな へやですか。', furigana: seg('どんな へやですか。'), translations: { en: 'What room?' }, link: { owner_type: 'conversation', owner_id: 'mnn-22-conv', role: '不動産屋', ordinal: 0 } });
        const row = db.getMinnaSentenceByExtId('mnn-22-conv-0')!;
        expect(row.ext_id).toBe('mnn-22-conv-0');
        expect(row.public).toBe(0);
        expect(row.source).toBe('minna');
        // seed-annotations attaches tokens by id; getMinnaAnnotations maps them by hash for the route.
        const tokens = [{ i: 0, start: 0, end: 3, surface: 'どんな', lemma: 'どんな', pos: 'DET', reading: 'ドンナ' }];
        db.upsertAnnotation({ sentenceId: row.id, tokens, bunsetsu: [], parser: 'test' });
        const map = db.getMinnaAnnotations();
        const hit = map.get(ttsTextHash('どんな へやですか。'));
        expect(hit?.tokens).toEqual(tokens);
        expect(hit?.furigana).toEqual(seg('どんな へやですか。'));
    });

    test('seedMinnaSentence is idempotent (re-seed does not duplicate rows/links/translations)', () => {
        const payload = { extId: 'mnn-22-ex-0', text: 'これは ほんです。', furigana: seg('これは ほんです。'), translations: { en: 'A book.' }, link: { owner_type: 'lesson', owner_id: '22', ordinal: 0 } };
        db.seedMinnaSentence(payload);
        db.seedMinnaSentence(payload);
        const n = (sql: string) => (mem.query(sql).get() as { n: number }).n;
        expect(n("SELECT COUNT(*) AS n FROM sentence WHERE source='minna'")).toBe(1);
        expect(n('SELECT COUNT(*) AS n FROM translation')).toBe(1);
        expect(n('SELECT COUNT(*) AS n FROM sentence_link')).toBe(1);
        expect(mem.query('SELECT owner_type, owner_id, ordinal FROM sentence_link').get()).toEqual({ owner_type: 'lesson', owner_id: '22', ordinal: 0 });
    });

    test('seedMinnaSentence preserves GiNZA grammar tags across a content re-seed (seed order safety)', () => {
        db.seedMinnaSentence({ extId: 'mnn-22-g1-0', text: 'たべます。', furigana: seg('たべます。'), translations: { en: 'eat' }, link: gLink });
        const row = db.getMinnaSentenceByExtId('mnn-22-g1-0')!;
        db.setGrammarTags(row.id, ['te-iru']); // simulate seed-annotations writing grammar after seed-sentences
        db.seedMinnaSentence({ extId: 'mnn-22-g1-0', text: 'たべます。', furigana: seg('たべます。'), translations: { en: 'eats' }, link: gLink }); // re-seed content
        expect((mem.query("SELECT value FROM sentence_tag WHERE kind='grammar'").all() as { value: string }[])).toEqual([{ value: 'te-iru' }]);
    });
});

describe('N3 grammar-catalog rows (seed-sentences Pass 5) — the PUBLIC grammar_point surface', () => {
    const seg = (text: string) => [{ t: text }];

    // The positive half of the Minna breach pin above: the two contents SHARE
    // owner_type='grammar_point', and an ownerType=grammar_point read must serve the public
    // catalog rows while the gated Minna rows stay dark — for anon and signed-in alike.
    test('anon + signed-in reads serve the catalog rows only, never the co-owner-typed Minna rows', () => {
        db.upsertPublicSentence({ extId: 'gp-you-ni-naru-0', text: 'およげるようになった。', furigana: seg('およげるようになった。'), source: 'grammar', translations: { en: 'Became able to swim.' }, tags: { grammar: ['you-ni-naru'] }, link: { owner_type: 'grammar_point', owner_id: 'you-ni-naru', ordinal: 0 } });
        db.seedMinnaSentence({ extId: 'mnn-22-g0-0', text: 'これは ほんです。', furigana: seg('これは ほんです。'), translations: { en: 'This is a book.' }, link: { owner_type: 'grammar_point', owner_id: 'mnn-22-g0', ordinal: 0 } });
        const anon = db.getSentences({ ownerType: 'grammar_point', viewer: null });
        expect(anon.map((s) => s.id)).toEqual(['gp-you-ni-naru-0']);
        // compactLink drops a FALSY ordinal from the wire — the client defaults absent → 0.
        expect(anon[0].link).toMatchObject({ owner_type: 'grammar_point', owner_id: 'you-ni-naru' });
        expect(anon[0].link?.ordinal ?? 0).toBe(0);
        expect(anon[0].tags?.grammar).toEqual(['you-ni-naru']);
        const u = db.createUser('u@x.com', 'h');
        expect(db.getSentences({ ownerType: 'grammar_point', viewer: u.id }).map((s) => s.id)).toEqual(['gp-you-ni-naru-0']);
    });

    test('ownerId narrows to one point; the (owner_id, ordinal-defaulted) key covers every example', () => {
        db.upsertPublicSentence({ extId: 'gp-a-1', text: 'ぶんに。', furigana: seg('ぶんに。'), source: 'grammar', translations: { en: '2' }, link: { owner_type: 'grammar_point', owner_id: 'a', ordinal: 1 } });
        db.upsertPublicSentence({ extId: 'gp-a-0', text: 'ぶんいち。', furigana: seg('ぶんいち。'), source: 'grammar', translations: { en: '1' }, link: { owner_type: 'grammar_point', owner_id: 'a', ordinal: 0 } });
        db.upsertPublicSentence({ extId: 'gp-b-0', text: 'べつのてん。', furigana: seg('べつのてん。'), source: 'grammar', translations: { en: 'other' }, link: { owner_type: 'grammar_point', owner_id: 'b', ordinal: 0 } });
        const a = db.getSentences({ ownerType: 'grammar_point', ownerId: 'a', viewer: null });
        expect(a.map((s) => s.id).sort()).toEqual(['gp-a-0', 'gp-a-1']);   // rows return in insertion (s.id) order, not by ordinal
        // The client's token-map key `${owner_id}:${ordinal ?? 0}` must cover both examples.
        const keys = new Set(a.map((s) => `${s.link?.owner_id}:${s.link?.ordinal ?? 0}`));
        expect(keys).toEqual(new Set(['a:0', 'a:1']));
    });
});
