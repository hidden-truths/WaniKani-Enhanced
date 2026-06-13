// DB repo CRUD against an in-memory SQLite. Verifies schema applies cleanly,
// upserts overwrite payload + count, serve counter increments correctly,
// and the warm-job audit log orders most-recent-first.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { openDb, _useDbForTesting } from './client.ts';
import * as db from './client.ts';
import { ttsTextHash } from '../services/tts.ts';

let mem: ReturnType<typeof openDb>;

beforeEach(() => {
    mem = openDb(':memory:');
    _useDbForTesting(mem);
});

afterEach(() => {
    _useDbForTesting(null);
    mem.close();
});

describe('vocab_examples CRUD', () => {
    test('upsert + get round-trip preserves payload', () => {
        const payload = { word: 'foo', examples: [{ id: 'a' }], fallbackImages: [] };
        db.upsertVocab('foo', payload, 1);
        const got = db.getVocab('foo');
        expect(got).not.toBeNull();
        expect(got!.payload).toEqual(payload);
        expect(got!.exampleCount).toBe(1);
        expect(got!.serveCount).toBe(0);
        expect(got!.lastServedAt).toBeNull();
    });

    test('upsert overwrites payload + example_count', () => {
        db.upsertVocab('foo', { v: 1 }, 5);
        db.upsertVocab('foo', { v: 2 }, 10);
        const got = db.getVocab('foo');
        expect(got!.payload).toEqual({ v: 2 });
        expect(got!.exampleCount).toBe(10);
    });

    test('upsert does NOT reset serve_count (warm preserves serve history)', () => {
        db.upsertVocab('foo', { v: 1 }, 1);
        db.recordVocabServe('foo');
        db.recordVocabServe('foo');
        db.upsertVocab('foo', { v: 2 }, 1);
        const got = db.getVocab('foo');
        expect(got!.serveCount).toBe(2); // preserved across re-warm
    });

    test('getVocab returns null for missing word', () => {
        expect(db.getVocab('nonexistent')).toBeNull();
    });

    test('recordVocabServe increments serve_count and updates last_served_at', () => {
        db.upsertVocab('foo', { v: 1 }, 1);
        const before = db.getVocab('foo')!;
        db.recordVocabServe('foo');
        const after = db.getVocab('foo')!;
        expect(after.serveCount).toBe(before.serveCount + 1);
        expect(after.lastServedAt).not.toBeNull();
        expect(after.lastServedAt!).toBeGreaterThanOrEqual(before.fetchedAt);
    });

    test('countVocabRows reflects current row count', () => {
        expect(db.countVocabRows()).toBe(0);
        db.upsertVocab('a', {}, 1);
        db.upsertVocab('b', {}, 1);
        expect(db.countVocabRows()).toBe(2);
        // Upserting an existing word doesn't grow the count.
        db.upsertVocab('a', {}, 2);
        expect(db.countVocabRows()).toBe(2);
    });
});

describe('index_meta CRUD', () => {
    test('returns null when never written', () => {
        expect(db.getIndexMeta()).toBeNull();
    });

    test('upsert + get round-trips decks', () => {
        const decks = {
            fate_zero: { title: 'Fate Zero', category: 'anime' },
            kill_la_kill: { title: 'Kill la Kill', category: 'anime' },
        };
        db.upsertIndexMeta(decks);
        const got = db.getIndexMeta();
        expect(got).not.toBeNull();
        expect(got!.decks).toEqual(decks);
        expect(got!.fetchedAt).toBeGreaterThan(0);
    });

    test('upsert replaces the singleton row entirely', () => {
        db.upsertIndexMeta({ a: { title: 'A', category: 'anime' } });
        db.upsertIndexMeta({ b: { title: 'B', category: 'drama' } });
        const got = db.getIndexMeta()!;
        expect(Object.keys(got.decks)).toEqual(['b']); // 'a' is gone
    });
});

describe('warm_jobs audit log', () => {
    test('createWarmJob + finishWarmJob round-trip', () => {
        const id = db.createWarmJob('word', 'foo');
        expect(id).toBeGreaterThan(0);
        db.finishWarmJob(id, 1, 0, null);
        const got = db.getLastWarmJob();
        expect(got).not.toBeNull();
        expect(got!.id).toBe(id);
        expect(got!.scope).toBe('word');
        expect(got!.target).toBe('foo');
        expect(got!.wordsProcessed).toBe(1);
        expect(got!.wordsFailed).toBe(0);
        expect(got!.error).toBeNull();
        expect(got!.finishedAt).not.toBeNull();
    });

    test('records error on failure', () => {
        const id = db.createWarmJob('word', 'baz');
        db.finishWarmJob(id, 0, 1, 'IK timeout');
        const got = db.getLastWarmJob()!;
        expect(got.wordsFailed).toBe(1);
        expect(got.error).toBe('IK timeout');
    });

    test('getLastWarmJob returns the most recent', () => {
        const a = db.createWarmJob('word', 'a');
        const b = db.createWarmJob('all', null);
        db.finishWarmJob(a, 1, 0, null);
        db.finishWarmJob(b, 50, 2, null);
        const got = db.getLastWarmJob()!;
        expect(got.id).toBe(b);
        expect(got.scope).toBe('all');
        expect(got.target).toBeNull();
    });

    test('listWarmJobs returns newest-first up to limit', () => {
        const ids = [
            db.createWarmJob('word', 'one'),
            db.createWarmJob('word', 'two'),
            db.createWarmJob('word', 'three'),
        ];
        ids.forEach((id) => db.finishWarmJob(id, 1, 0, null));
        const all = db.listWarmJobs(10);
        expect(all.map((j) => j.target)).toEqual(['three', 'two', 'one']);
        // Limit honored.
        const top1 = db.listWarmJobs(1);
        expect(top1).toHaveLength(1);
        expect(top1[0].target).toBe('three');
    });

    test('listWarmJobs returns empty array when there are no jobs', () => {
        expect(db.listWarmJobs(10)).toEqual([]);
    });
});

describe('study_sessions append-only log', () => {
    test('insertSession appends and countSessions counts per user', () => {
        const u = db.createUser('s@example.com', 'hash');
        expect(db.countSessions(u.id)).toBe(0);
        const id1 = db.insertSession(u.id, 1000, 4, 6, 'meaning', null);
        const id2 = db.insertSession(u.id, 2000, 2, 8, 'reading', { deck: 'leech' });
        expect(id2).toBeGreaterThan(id1);
        expect(db.countSessions(u.id)).toBe(2);
        // a second user's log is independent
        const u2 = db.createUser('t@example.com', 'hash');
        db.insertSession(u2.id, 3000, 5, 5, null, null);
        expect(db.countSessions(u2.id)).toBe(1);
        expect(db.countSessions(u.id)).toBe(2);
    });

    test('sessions cascade-delete with the user', () => {
        const u = db.createUser('c@example.com', 'hash');
        db.insertSession(u.id, 1000, 1, 2, 'meaning', null);
        mem.query('DELETE FROM users WHERE id = ?').run(u.id);
        expect(db.countSessions(u.id)).toBe(0);
    });
});

describe('minna_recordings (record-and-compare)', () => {
    // Insert a take with an explicit createdAt so ordering tests are deterministic.
    const add = (userId: number, lesson: number, itemKey: string, createdAt: number) =>
        db.insertRecording(userId, lesson, itemKey, `rec/${userId}/${itemKey}/${createdAt}.webm`, 'audio/webm', 1500, createdAt);

    test('insert + list returns a lesson’s takes newest-first', () => {
        const u = db.createUser('r@example.com', 'hash');
        add(u.id, 23, 'mnn:23:0', 1000);
        add(u.id, 23, 'mnn:23:0', 3000);
        add(u.id, 23, 'mnn:23:1', 2000);
        const list = db.listRecordings(u.id, 23);
        expect(list.map((r) => r.createdAt)).toEqual([3000, 2000, 1000]);
        expect(list[0]!.contentType).toBe('audio/webm');
    });

    test('list is scoped per (user, lesson)', () => {
        const u = db.createUser('a@example.com', 'hash');
        const v = db.createUser('b@example.com', 'hash');
        add(u.id, 23, 'mnn:23:0', 1000);
        add(u.id, 24, 'mnn:24:0', 1000);
        add(v.id, 23, 'mnn:23:0', 1000);
        expect(db.listRecordings(u.id, 23)).toHaveLength(1);
        expect(db.listRecordings(u.id, 24)).toHaveLength(1);
        expect(db.listRecordings(v.id, 23)).toHaveLength(1);
    });

    test('getRecording is owner-scoped (a guessed id from another account 404s)', () => {
        const u = db.createUser('o@example.com', 'hash');
        const v = db.createUser('p@example.com', 'hash');
        const id = add(u.id, 23, 'mnn:23:0', 1000);
        expect(db.getRecording(u.id, id)).not.toBeNull();
        expect(db.getRecording(v.id, id)).toBeNull();
    });

    test('deleteRecording removes only the owner’s row and returns it', () => {
        const u = db.createUser('d@example.com', 'hash');
        const v = db.createUser('e@example.com', 'hash');
        const id = add(u.id, 23, 'mnn:23:0', 1000);
        expect(db.deleteRecording(v.id, id)).toBeNull(); // not the owner → no-op
        const row = db.deleteRecording(u.id, id);
        expect(row).not.toBeNull();
        expect(row!.storageKey).toContain('mnn:23:0');
        expect(db.getRecording(u.id, id)).toBeNull();
    });

    test('pruneRecordings keeps the newest N of an item and returns the dropped rows', () => {
        const u = db.createUser('k@example.com', 'hash');
        for (const t of [1000, 2000, 3000, 4000, 5000]) add(u.id, 23, 'mnn:23:0', t);
        add(u.id, 23, 'mnn:23:1', 9000); // a different item — must be untouched
        const dropped = db.pruneRecordings(u.id, 23, 'mnn:23:0', 3);
        expect(dropped.map((r) => r.createdAt).sort()).toEqual([1000, 2000]);
        const remaining = db.listRecordings(u.id, 23).filter((r) => r.itemKey === 'mnn:23:0');
        expect(remaining.map((r) => r.createdAt)).toEqual([5000, 4000, 3000]);
        // the other item is left alone
        expect(db.listRecordings(u.id, 23).filter((r) => r.itemKey === 'mnn:23:1')).toHaveLength(1);
    });

    test('pruneRecordings is a no-op when under the cap', () => {
        const u = db.createUser('n@example.com', 'hash');
        add(u.id, 23, 'mnn:23:0', 1000);
        add(u.id, 23, 'mnn:23:0', 2000);
        expect(db.pruneRecordings(u.id, 23, 'mnn:23:0', 3)).toEqual([]);
        expect(db.listRecordings(u.id, 23)).toHaveLength(2);
    });

    test('recordings cascade-delete with the user', () => {
        const u = db.createUser('cascade@example.com', 'hash');
        add(u.id, 23, 'mnn:23:0', 1000);
        mem.query('DELETE FROM users WHERE id = ?').run(u.id);
        expect(db.listRecordings(u.id, 23)).toHaveLength(0);
    });

    test('recordingSummary aggregates per lesson (distinct items, take counts, last time)', () => {
        const u = db.createUser('hist@example.com', 'hash');
        // L23: two items, three takes total; L24: one item, one take.
        add(u.id, 23, 'mnn:23:0', 1000);
        add(u.id, 23, 'mnn:23:0', 5000); // same item, newer
        add(u.id, 23, 'mnn:23:1', 3000);
        add(u.id, 24, 'mnn:24:0', 2000);
        const summary = db.recordingSummary(u.id);
        expect(summary).toEqual([
            { lesson: 23, items: 2, takes: 3, lastCreatedAt: 5000 },
            { lesson: 24, items: 1, takes: 1, lastCreatedAt: 2000 },
        ]);
    });

    test('recordingSummary is owner-scoped and empty when nothing recorded', () => {
        const u = db.createUser('empty@example.com', 'hash');
        const v = db.createUser('other@example.com', 'hash');
        add(v.id, 23, 'mnn:23:0', 1000); // another user's take must not leak in
        expect(db.recordingSummary(u.id)).toEqual([]);
        expect(db.recordingSummary(v.id)).toEqual([{ lesson: 23, items: 1, takes: 1, lastCreatedAt: 1000 }]);
    });
});

describe('audio_variants (tagged voice-clip manifest)', () => {
    test('insert + list returns a text’s variants', () => {
        db.insertAudioVariant('hash1', 'siri', 'female', 'm4a');
        db.insertAudioVariant('hash1', 'siri', 'male', 'm4a');
        const list = db.listAudioVariants('hash1');
        expect(list.map((r) => `${r.provider}:${r.gender}`).sort()).toEqual(['siri:female', 'siri:male']);
        expect(list[0]!.ext).toBe('m4a');
    });

    test('list is scoped per text_hash', () => {
        db.insertAudioVariant('hashA', 'siri', 'female', 'm4a');
        db.insertAudioVariant('hashB', 'siri', 'male', 'm4a');
        expect(db.listAudioVariants('hashA')).toHaveLength(1);
        expect(db.listAudioVariants('hashB')).toHaveLength(1);
        expect(db.listAudioVariants('missing')).toEqual([]);
    });

    test('re-inserting the same (text, provider, gender) is idempotent (no duplicate)', () => {
        db.insertAudioVariant('h', 'siri', 'female', 'm4a');
        db.insertAudioVariant('h', 'siri', 'female', 'm4a'); // same voice again
        expect(db.listAudioVariants('h')).toHaveLength(1);
    });

    test('gender defaults to empty string for a no-gender provider', () => {
        db.insertAudioVariant('h2', 'siri', '', 'm4a');
        expect(db.listAudioVariants('h2')[0]!.gender).toBe('');
    });
});

// The privacy filter (getSentences) is the single gate the whole Self-Talk feature's
// privacy rests on; these are BREACH-PREVENTION pins (à la the ikTitles dead-end pins),
// not nice-to-haves. If one breaks, a private user sentence is about to leak — do not
// "fix" the test, fix the leak.
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

// Phase 4 (NLP): sentence_annotation carries GiNZA tokens/bunsetsu keyed by char offset into
// sentence.text. Two load-bearing properties: (1) the offset contract — every token's [start,end)
// reconstructs its surface under JS (UTF-16) slicing, enforced on write; (2) the READ rides the
// SAME privacy gate as getSentences, so a private sentence's annotation never leaks. The non-BMP
// + privacy tests below are BREACH/CONTRACT pins — if one breaks, fix the code, not the test.
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
});
