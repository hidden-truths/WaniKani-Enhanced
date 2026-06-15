// Songs repo — the song library + BYO-song CRUD, with the lyric lines living in the sentence
// store (owner_type='song'). The privacy describe block is BREACH-PREVENTION (like the sentence
// store pins): a private BYO song's lyrics must never leak to anon or another user. If one breaks,
// fix the leak, not the test. The rest is direct coverage of the line model, timing, words, and the
// reuse-by-hash public-starter path.

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

// All-kana furigana (one segment) — satisfies concat(seg.t)===text without hand-writing ruby.
const seg = (text: string) => [{ t: text }];
const n = (sql: string) => (mem.query(sql).get() as { n: number }).n;
// A content-word token: text.slice(start,end) must equal surface (UTF-16). jlpt/gloss optional.
const tok = (start: number, end: number, surface: string, pos: string, jlpt?: string, gloss?: string) => ({
    i: 0,
    start,
    end,
    surface,
    lemma: surface,
    pos,
    reading: surface,
    ...(jlpt ? { jlpt } : {}),
    ...(gloss ? { gloss } : {}),
});

// A small two-line private song with grammar, tokens, jlpt/gloss, and one timed line.
function sampleLines() {
    return [
        {
            text: 'うたをうたう',
            furigana: seg('うたをうたう'),
            en: 'I sing a song',
            grammar: ['te-iru'],
            tokens: [tok(0, 2, 'うた', 'NOUN', 'N5', 'song'), tok(2, 3, 'を', 'ADP'), tok(3, 6, 'うたう', 'VERB', 'N5', 'to sing')],
            clipStartMs: 8000,
        },
        { text: 'またあした', furigana: seg('またあした'), en: 'see you tomorrow', tokens: [tok(2, 5, 'あした', 'NOUN', 'N5', 'tomorrow')] },
    ];
}

describe('songs — create + read + the assembled line model', () => {
    test('createSong persists metadata + ordered lines with furigana/en/grammar/tokens/clip', () => {
        const a = db.createUser('a@x.com', 'h');
        const song = db.createSong({ extId: 'usr-a-1', title: 'テスト', artist: 'X', youtubeId: 'abc123', createdBy: a.id, lines: sampleLines() });
        expect(song.id).toBe('usr-a-1');
        expect(song.custom).toBe(true);
        expect(song.lineCount).toBe(2);
        expect(song.timedCount).toBe(1); // only line 0 has a clip start
        const l0 = song.lines[0]!;
        expect(l0.text).toBe('うたをうたう');
        expect(l0.translations.en).toBe('I sing a song');
        expect(l0.tags.grammar).toEqual(['te-iru']);
        // Line ordinal = ARRAY INDEX (lines are server-sorted + contiguous). compactLink omits a
        // falsy ordinal, so line 0's link.ordinal is undefined; line 1 carries an explicit 1.
        expect(song.lines[1]!.link.ordinal).toBe(1);
        expect(l0.link.clip_start_ms).toBe(8000);
        expect(l0.annotation?.tokens.map((t) => t.surface)).toEqual(['うた', 'を', 'うたう']);
        expect(l0.annotation?.parser).toBe('llm'); // runtime LLM provenance, not GiNZA
    });

    test('lines come back in ordinal (array-index) order', () => {
        const a = db.createUser('a@x.com', 'h');
        const song = db.createSong({ extId: 'usr-a-2', title: 'T', createdBy: a.id, lines: [
            { text: 'いち', furigana: seg('いち') },
            { text: 'に', furigana: seg('に') },
            { text: 'さん', furigana: seg('さん') },
        ] });
        expect(song.lines.map((l) => l.text)).toEqual(['いち', 'に', 'さん']);
        // The DB stores correct 0-based ordinals (what timing keys on), even where the assembled link omits 0.
        expect((mem.query("SELECT ordinal FROM sentence_link WHERE owner_type='song' ORDER BY ordinal").all() as { ordinal: number }[]).map((r) => r.ordinal)).toEqual([0, 1, 2]);
    });
});

describe('songs — privacy + ownership pins (BREACH PREVENTION)', () => {
    test('a private song is visible to its owner, invisible to another user and to anon', () => {
        const a = db.createUser('a@x.com', 'h');
        const b = db.createUser('b@x.com', 'h');
        db.createSong({ extId: 'usr-a-1', title: 'ひみつ', createdBy: a.id, lines: sampleLines() });
        expect(db.getSong({ extId: 'usr-a-1', viewer: a.id })).not.toBeNull();
        expect(db.getSong({ extId: 'usr-a-1', viewer: b.id })).toBeNull();
        expect(db.getSong({ extId: 'usr-a-1', viewer: null })).toBeNull();
        // The library list applies the SAME gate.
        expect(db.getSongs({ viewer: a.id }).map((s) => s.id)).toEqual(['usr-a-1']);
        expect(db.getSongs({ viewer: b.id })).toEqual([]);
        expect(db.getSongs({ viewer: null })).toEqual([]);
    });

    test("a private song's lyric LINES never leak through getSentences to anon/another user", () => {
        const a = db.createUser('a@x.com', 'h');
        const b = db.createUser('b@x.com', 'h');
        db.createSong({ extId: 'usr-a-1', title: 'ひみつ', createdBy: a.id, lines: sampleLines() });
        expect(db.getSentences({ ownerType: 'song', ownerId: 'usr-a-1', viewer: a.id }).length).toBe(2); // owner sees the lines
        expect(db.getSentences({ ownerType: 'song', ownerId: 'usr-a-1', viewer: b.id })).toEqual([]); // not another user's
        expect(db.getSentences({ ownerType: 'song', ownerId: 'usr-a-1', viewer: null })).toEqual([]); // not anon's
    });

    test('public starters ARE anon-readable; a viewer sees starters + own private together', () => {
        const a = db.createUser('a@x.com', 'h');
        db.upsertPublicSong({ extId: 'song-pd', title: 'ふるさと', artist: 'public-domain', lines: [{ text: 'やま', furigana: seg('やま'), en: 'mountain' }] });
        db.createSong({ extId: 'usr-a-1', title: 'mine', createdBy: a.id, lines: sampleLines() });
        expect(db.getSong({ extId: 'song-pd', viewer: null })).not.toBeNull(); // anon reads the starter
        const seen = db.getSongs({ viewer: a.id });
        expect(seen.map((s) => s.id).sort()).toEqual(['song-pd', 'usr-a-1']);
        expect(new Map(seen.map((s) => [s.id, s.custom]))).toEqual(new Map([['song-pd', false], ['usr-a-1', true]]));
    });

    test('the public_song VIEW excludes a private song', () => {
        const a = db.createUser('a@x.com', 'h');
        db.upsertPublicSong({ extId: 'song-pd', title: 'PD', lines: [{ text: 'うみ', furigana: seg('うみ') }] });
        db.createSong({ extId: 'usr-a-1', title: 'mine', createdBy: a.id, lines: sampleLines() });
        const view = (mem.query('SELECT ext_id FROM public_song ORDER BY ext_id').all() as { ext_id: string }[]).map((r) => r.ext_id);
        expect(view).toEqual(['song-pd']);
    });
});

describe('songs — words (Mine vocab) + coverage inputs', () => {
    test('the library list exposes DISTINCT content words with their JLPT (particles excluded)', () => {
        const a = db.createUser('a@x.com', 'h');
        db.createSong({ extId: 'usr-a-1', title: 'T', createdBy: a.id, lines: sampleLines() });
        const words = db.getSongs({ viewer: a.id })[0]!.words;
        expect(words).toContainEqual({ lemma: 'うた', jlpt: 'N5' });
        expect(words).toContainEqual({ lemma: 'うたう', jlpt: 'N5' });
        expect(words).toContainEqual({ lemma: 'あした', jlpt: 'N5' });
        expect(words.some((w) => w.lemma === 'を')).toBe(false); // ADP is not a content word
    });

    test('a repeated word across lines is counted once', () => {
        const a = db.createUser('a@x.com', 'h');
        db.createSong({ extId: 'usr-a-1', title: 'T', createdBy: a.id, lines: [
            { text: 'うたううた', furigana: seg('うたううた'), tokens: [tok(0, 3, 'うたう', 'VERB', 'N5'), tok(3, 5, 'うた', 'NOUN', 'N5')] },
            { text: 'またうたう', furigana: seg('またうたう'), tokens: [tok(2, 5, 'うたう', 'VERB', 'N5')] },
        ] });
        const words = db.getSongs({ viewer: a.id })[0]!.words;
        expect(words.filter((w) => w.lemma === 'うたう').length).toBe(1);
    });
});

describe('songs — timing + update + delete (owner-scoped)', () => {
    test('updateSongTiming sets per-line clip starts by ordinal; non-owner is a null no-op', () => {
        const a = db.createUser('a@x.com', 'h');
        const b = db.createUser('b@x.com', 'h');
        db.createSong({ extId: 'usr-a-1', title: 'T', createdBy: a.id, lines: sampleLines() });
        expect(db.updateSongTiming({ extId: 'usr-a-1', viewer: b.id, timings: [{ ordinal: 1, clipStartMs: 1 }] })).toBeNull();
        const s = db.updateSongTiming({ extId: 'usr-a-1', viewer: a.id, timings: [{ ordinal: 1, clipStartMs: 15000 }] });
        expect(s!.lines[1]!.link.clip_start_ms).toBe(15000);
        expect(s!.timedCount).toBe(2);
    });

    test('updateSong edits metadata (owner only)', () => {
        const a = db.createUser('a@x.com', 'h');
        const b = db.createUser('b@x.com', 'h');
        db.createSong({ extId: 'usr-a-1', title: 'old', createdBy: a.id, lines: sampleLines() });
        expect(db.updateSong({ extId: 'usr-a-1', viewer: b.id, title: 'hijack' })).toBeNull();
        const s = db.updateSong({ extId: 'usr-a-1', viewer: a.id, title: 'new', artist: 'Y', youtubeId: 'zzz' });
        expect([s!.title, s!.artist, s!.youtubeId]).toEqual(['new', 'Y', 'zzz']);
    });

    test('deleteSong removes the song + its line rows (owner only); non-owner is a false no-op', () => {
        const a = db.createUser('a@x.com', 'h');
        const b = db.createUser('b@x.com', 'h');
        db.createSong({ extId: 'usr-a-1', title: 'T', createdBy: a.id, lines: sampleLines() });
        expect(db.deleteSong({ extId: 'usr-a-1', viewer: b.id })).toBe(false);
        expect(db.deleteSong({ extId: 'usr-a-1', viewer: a.id })).toBe(true);
        expect(db.getSong({ extId: 'usr-a-1', viewer: a.id })).toBeNull();
        expect(n("SELECT COUNT(*) AS n FROM sentence WHERE source='song'")).toBe(0); // line rows + cascade gone
        expect(n("SELECT COUNT(*) AS n FROM sentence_link WHERE owner_type='song'")).toBe(0);
    });

    test('countUserSongs counts only the viewer’s own songs', () => {
        const a = db.createUser('a@x.com', 'h');
        const b = db.createUser('b@x.com', 'h');
        db.upsertPublicSong({ extId: 'song-pd', title: 'PD', lines: [{ text: 'a', furigana: seg('a') }] });
        db.createSong({ extId: 'usr-a-1', title: 'T', createdBy: a.id, lines: [{ text: 'b', furigana: seg('b') }] });
        db.createSong({ extId: 'usr-a-2', title: 'T', createdBy: a.id, lines: [{ text: 'c', furigana: seg('c') }] });
        expect(db.countUserSongs(a.id)).toBe(2);
        expect(db.countUserSongs(b.id)).toBe(0); // public starter doesn't count toward any user
    });
});

describe('songs — public starter reuse-by-hash + idempotency', () => {
    test('a repeated chorus line collapses to ONE public sentence row with multiple song links', () => {
        db.upsertPublicSong({ extId: 'song-x', title: 'Chorus', lines: [
            { text: 'ラララ', furigana: seg('ラララ'), en: 'la la la' },
            { text: 'ラララ', furigana: seg('ラララ'), en: 'la la la' }, // repeated
        ] });
        expect(n('SELECT COUNT(*) AS n FROM sentence')).toBe(1);
        expect(n("SELECT COUNT(*) AS n FROM sentence_link WHERE owner_type='song'")).toBe(2);
        const pub = db.getSong({ extId: 'song-x', viewer: null })!;
        expect(pub.lineCount).toBe(2);
        // One shared row, two links at ordinals 0 and 1 (the chorus repeats).
        expect((mem.query("SELECT ordinal FROM sentence_link WHERE owner_type='song' ORDER BY ordinal").all() as { ordinal: number }[]).map((r) => r.ordinal)).toEqual([0, 1]);
    });

    test('upsertPublicSong is idempotent — re-seed does not grow songs/rows/links', () => {
        const payload = { extId: 'song-x', title: 'PD', lines: [{ text: 'やま', furigana: seg('やま'), en: 'mountain' }, { text: 'かわ', furigana: seg('かわ'), en: 'river' }] };
        db.upsertPublicSong(payload);
        db.upsertPublicSong(payload);
        expect(n('SELECT COUNT(*) AS n FROM song')).toBe(1);
        expect(n("SELECT COUNT(*) AS n FROM sentence WHERE source='song'")).toBe(2);
        expect(n("SELECT COUNT(*) AS n FROM sentence_link WHERE owner_type='song'")).toBe(2);
    });
});

describe('songs — write validation (no partial writes)', () => {
    test('bad furigana aborts the create before any row is written', () => {
        const a = db.createUser('a@x.com', 'h');
        expect(() => db.createSong({ extId: 'usr-bad', title: 'T', createdBy: a.id, lines: [{ text: 'ほんとう', furigana: [{ t: 'ちがう' }] }] })).toThrow();
        expect(n('SELECT COUNT(*) AS n FROM song')).toBe(0); // no orphan song row
    });

    test('a bad token offset aborts the create before any row is written', () => {
        const a = db.createUser('a@x.com', 'h');
        // slice(0,2) of 'うた' is 'うた', not the claimed surface 'うたう' → offset gate.
        expect(() => db.createSong({ extId: 'usr-bad', title: 'T', createdBy: a.id, lines: [{ text: 'うた', furigana: seg('うた'), tokens: [tok(0, 2, 'うたう', 'VERB')] }] })).toThrow();
        expect(n('SELECT COUNT(*) AS n FROM song')).toBe(0);
        expect(n("SELECT COUNT(*) AS n FROM sentence WHERE source='song'")).toBe(0);
    });
});
