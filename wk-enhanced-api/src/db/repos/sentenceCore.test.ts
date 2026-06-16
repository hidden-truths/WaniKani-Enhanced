// sentenceCore shared substrate — direct coverage for the two helpers extracted from the three
// repos that hand-rolled them (createSentence / replaceUserCardExamples / insertSongLine):
//   • insertPrivateSentenceRow — the canonical private-row INSERT (columns + hash derivation)
//   • deleteOwnedLines        — the owner-scoped "delete this owner's lines" (a PRIVACY property:
//                               it must NEVER reach a public/curator row or another user's)
// These run only indirectly through the higher-level repos elsewhere; pinned here so the shared
// copy can't regress without a focused failure.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { openDb, _useDbForTesting, getDb } from '../connection.ts';
import * as db from '../client.ts';
import { ttsTextHash } from '../../services/tts.ts';
import { insertPrivateSentenceRow, deleteOwnedLines, insertSentenceChildren } from './sentenceCore.ts';

let mem: ReturnType<typeof openDb>;

beforeEach(() => {
    mem = openDb(':memory:');
    _useDbForTesting(mem);
});

afterEach(() => {
    _useDbForTesting(null);
    mem.close();
});

type Row = {
    ext_id: string; hash: string; text: string; furigana: string | null;
    lang: string; source: string; public: number; visibility: string; created_by: number | null;
};
const rowById = (id: number) => getDb().query('SELECT * FROM sentence WHERE id = ?').get(id) as Row;

describe('insertPrivateSentenceRow', () => {
    test('writes a private (public=0/visibility=private/lang=ja) row with the server-derived hash', () => {
        const u = db.createUser('a@x.com', 'h');
        const id = insertPrivateSentenceRow({
            extId: 'usr-a-1', text: '私のぶん。', furigana: [{ t: '私', r: 'わたし' }, { t: 'のぶん。' }],
            source: 'song', createdBy: u.id,
        });
        const row = rowById(id);
        expect(row).toMatchObject({
            ext_id: 'usr-a-1', text: '私のぶん。', lang: 'ja', source: 'song',
            public: 0, visibility: 'private', created_by: u.id,
        });
        // hash is computed HERE from text (the audio-layer key) — never client-set.
        expect(row.hash).toBe(ttsTextHash('私のぶん。'));
        expect(JSON.parse(row.furigana!)).toEqual([{ t: '私', r: 'わたし' }, { t: 'のぶん。' }]);
    });

    test('stores null furigana as a NULL column (no ruby)', () => {
        const u = db.createUser('a@x.com', 'h');
        const id = insertPrivateSentenceRow({ extId: 'usr-a-2', text: 'かな。', furigana: null, source: 'custom', createdBy: u.id });
        expect(rowById(id).furigana).toBeNull();
    });

    test('carries the source through verbatim (song / custom / selftalk share one INSERT)', () => {
        const u = db.createUser('a@x.com', 'h');
        for (const source of ['song', 'custom', 'selftalk']) {
            const id = insertPrivateSentenceRow({ extId: `usr-a-${source}`, text: `${source}。`, furigana: null, source, createdBy: u.id });
            expect(rowById(id).source).toBe(source);
        }
    });
});

describe('deleteOwnedLines', () => {
    // Create a private line owned by `viewer`, linked under (ownerType, ownerId), with children.
    function makeLine(viewer: number, extId: string, ownerType: string, ownerId: string): number {
        const id = insertPrivateSentenceRow({ extId, text: `${extId}。`, furigana: null, source: 'song', createdBy: viewer });
        insertSentenceChildren(id, { en: 'x' }, { grammar: ['tai'] }, { owner_type: ownerType, owner_id: ownerId, ordinal: 0 });
        return id;
    }
    const exists = (id: number) => getDb().query('SELECT 1 FROM sentence WHERE id = ?').get(id) != null;
    const childCount = (id: number) =>
        (getDb().query('SELECT (SELECT COUNT(*) FROM translation WHERE sentence_id=?1) + (SELECT COUNT(*) FROM sentence_tag WHERE sentence_id=?1) + (SELECT COUNT(*) FROM sentence_link WHERE sentence_id=?1) AS n').get(id) as { n: number }).n;

    test("deletes the owner's matching lines and cascades their children", () => {
        const a = db.createUser('a@x.com', 'h');
        const id = makeLine(a.id, 'usr-a-L0', 'song', 'song-1');
        expect(childCount(id)).toBe(3); // 1 translation + 1 tag + 1 link
        deleteOwnedLines('song', 'song-1', a.id);
        expect(exists(id)).toBe(false);
        expect(childCount(id)).toBe(0); // FK ON DELETE CASCADE took the children
    });

    test("NEVER touches another user's rows (owner-scoping is a privacy property)", () => {
        const a = db.createUser('a@x.com', 'h');
        const b = db.createUser('b@x.com', 'h');
        const aId = makeLine(a.id, 'usr-a-L0', 'song', 'song-1');
        const bId = makeLine(b.id, 'usr-b-L0', 'song', 'song-1'); // same owner_id, different user
        deleteOwnedLines('song', 'song-1', a.id);
        expect(exists(aId)).toBe(false);
        expect(exists(bId)).toBe(true); // b's row survives — never deleted by a's call
    });

    test('NEVER touches a public/curator (created_by NULL) row sharing the owner link', () => {
        const a = db.createUser('a@x.com', 'h');
        const pubId = insertPrivateSentenceRow({ extId: 'will-be-public', text: 'パブ。', furigana: null, source: 'song', createdBy: a.id });
        getDb().query('UPDATE sentence SET created_by = NULL, public = 1 WHERE id = ?').run(pubId);
        insertSentenceChildren(pubId, undefined, undefined, { owner_type: 'song', owner_id: 'song-1', ordinal: 0 });
        deleteOwnedLines('song', 'song-1', a.id);
        expect(exists(pubId)).toBe(true); // created_by NULL ⇒ never matches a viewer-scoped delete
    });

    test('scopes to the exact (ownerType, ownerId) — leaves the same user\'s other owners alone', () => {
        const a = db.createUser('a@x.com', 'h');
        const s1 = makeLine(a.id, 'usr-a-s1', 'song', 'song-1');
        const s2 = makeLine(a.id, 'usr-a-s2', 'song', 'song-2');
        const card = makeLine(a.id, 'usr-a-card', 'card', 'song-1'); // same owner_id, different ownerType
        deleteOwnedLines('song', 'song-1', a.id);
        expect(exists(s1)).toBe(false);
        expect(exists(s2)).toBe(true); // different owner_id
        expect(exists(card)).toBe(true); // different owner_type
    });
});
