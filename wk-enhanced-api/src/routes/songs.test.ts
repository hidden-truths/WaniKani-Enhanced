// Songs route tests — the HTTP surface via Hono's in-process app.fetch(): auth gating, library
// privacy, create/upsert, the conflict + per-account cap + oversize guards, and ownership on
// GET/DELETE. Plus the pure parseYouTubeId SSRF/format guard. The Claude analyze call is NOT
// exercised (it 503s without a key); these cover the Phase 1 store/CRUD surface.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import { zodHook } from '../lib/zodHook.ts';
import { songsRouter, parseYouTubeId } from './songs.ts';
import { openDb, _useDbForTesting } from '../db/client.ts';
import * as db from '../db/client.ts';

let mem: ReturnType<typeof openDb>;
let app: OpenAPIHono;

beforeEach(() => {
    mem = openDb(':memory:');
    _useDbForTesting(mem);
    app = new OpenAPIHono({ defaultHook: zodHook });
    app.route('/v1/songs', songsRouter);
});

afterEach(() => {
    _useDbForTesting(null);
    mem.close();
});

const seg = (t: string) => [{ t }];
function signIn(email: string, token: string) {
    const u = db.createUser(email, 'h');
    db.createSession(token, u.id, Date.now() + 100_000);
    return u;
}
// Build a request, attaching the session cookie + JSON content-type as needed.
function req(path: string, init: RequestInit & { token?: string } = {}) {
    const { token, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (token) headers.set('Cookie', 'wk_session=' + token);
    if (rest.body) headers.set('Content-Type', 'application/json');
    return app.fetch(new Request('http://test.local' + path, { ...rest, headers }));
}
const J = (o: unknown) => JSON.stringify(o);
const songBody = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    title: 'T',
    lines: [{ text: 'やま', furigana: seg('やま'), en: 'mountain' }],
    ...over,
});

describe('parseYouTubeId — format + SSRF guard', () => {
    const ID = 'dQw4w9WgXcQ';
    test('accepts watch / youtu.be / embed / shorts / m. forms', () => {
        expect(parseYouTubeId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
        expect(parseYouTubeId(`https://youtube.com/watch?v=${ID}&t=42s`)).toBe(ID);
        expect(parseYouTubeId(`https://youtu.be/${ID}`)).toBe(ID);
        expect(parseYouTubeId(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
        expect(parseYouTubeId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
        expect(parseYouTubeId(`https://m.youtube.com/watch?v=${ID}`)).toBe(ID);
    });
    test('rejects non-YouTube hosts (the SSRF guard) + lookalikes', () => {
        expect(parseYouTubeId(`https://evil.com/watch?v=${ID}`)).toBeNull();
        expect(parseYouTubeId(`https://youtube.com.evil.com/watch?v=${ID}`)).toBeNull();
        expect(parseYouTubeId(`https://notyoutube.com/watch?v=${ID}`)).toBeNull();
        expect(parseYouTubeId(`https://youtu.be.evil.com/${ID}`)).toBeNull();
    });
    test('rejects malformed ids + non-URLs', () => {
        expect(parseYouTubeId('https://youtu.be/<script>')).toBeNull();
        expect(parseYouTubeId('https://www.youtube.com/watch?v=')).toBeNull();
        expect(parseYouTubeId('not a url')).toBeNull();
        expect(parseYouTubeId('javascript:alert(1)')).toBeNull();
    });
});

describe('GET /v1/songs — library gating', () => {
    test('anon sees public starters only; a signed-in user sees starters + own private', async () => {
        db.upsertPublicSong({ extId: 'song-pd', title: 'PD', lines: [{ text: 'うみ', furigana: seg('うみ') }] });
        const a = signIn('a@x.com', 'atok');
        db.createSong({ extId: 'usr-a-1', title: 'mine', createdBy: a.id, lines: [{ text: 'やま', furigana: seg('やま') }] });

        const anon = await req('/v1/songs');
        expect(anon.status).toBe(200);
        expect(((await anon.json()) as any).songs.map((s: any) => s.id)).toEqual(['song-pd']);

        const mine = await req('/v1/songs', { token: 'atok' });
        expect(((await mine.json()) as any).songs.map((s: any) => s.id).sort()).toEqual(['song-pd', 'usr-a-1']);
    });
});

describe('POST /v1/songs — auth, create, upsert, conflict, cap', () => {
    test('401 without a session', async () => {
        expect((await req('/v1/songs', { method: 'POST', body: J(songBody('usr-x')) })).status).toBe(401);
    });

    test('create, then a re-POST of the SAME id upserts (replaces lines), not a no-op', async () => {
        const a = signIn('a@x.com', 'atok');
        let res = await req('/v1/songs', { method: 'POST', token: 'atok', body: J(songBody('usr-a-1', { title: 'first' })) });
        expect(res.status).toBe(200);
        expect(((await res.json()) as any).song.title).toBe('first');

        res = await req('/v1/songs', {
            method: 'POST',
            token: 'atok',
            body: J(
                songBody('usr-a-1', {
                    title: 'second',
                    lines: [
                        { text: 'かわ', furigana: seg('かわ'), en: 'river' },
                        { text: 'そら', furigana: seg('そら'), en: 'sky' },
                    ],
                }),
            ),
        });
        expect(res.status).toBe(200);
        const s = ((await res.json()) as any).song;
        expect(s.title).toBe('second');
        expect(s.lines.map((l: any) => l.text)).toEqual(['かわ', 'そら']);
        expect(db.countUserSongs(a.id)).toBe(1); // still exactly one song — upsert, not a second insert
    });

    test("409 for a public-starter id or another account's private id", async () => {
        db.upsertPublicSong({ extId: 'song-pd', title: 'PD', lines: [{ text: 'うみ', furigana: seg('うみ') }] });
        signIn('a@x.com', 'atok');
        const b = signIn('b@x.com', 'btok');
        db.createSong({ extId: 'usr-b-1', title: 'bs', createdBy: b.id, lines: [{ text: 'やま', furigana: seg('やま') }] });

        expect((await req('/v1/songs', { method: 'POST', token: 'atok', body: J(songBody('song-pd')) })).status).toBe(409);
        const other = await req('/v1/songs', { method: 'POST', token: 'atok', body: J(songBody('usr-b-1')) });
        expect(other.status).toBe(409);
        expect(((await other.json()) as any).code).toBe('conflict');
    });

    test('rejects an oversize body with 400', async () => {
        signIn('a@x.com', 'atok');
        const big = 'あ'.repeat(400);
        const lines = Array.from({ length: 400 }, () => ({ text: big, furigana: [{ t: big }], en: 'x'.repeat(600) }));
        const res = await req('/v1/songs', { method: 'POST', token: 'atok', body: J({ id: 'usr-a-big', title: 'T', lines }) });
        expect(res.status).toBe(400);
        expect(((await res.json()) as any).error).toMatch(/too large/);
    });

    test('rejects the song past the per-account cap with 400', async () => {
        const a = signIn('a@x.com', 'atok');
        for (let i = 0; i < 200; i++) {
            db.createSong({ extId: `usr-a-${i}`, title: 'T', createdBy: a.id, lines: [{ text: 'や', furigana: seg('や') }] });
        }
        const res = await req('/v1/songs', { method: 'POST', token: 'atok', body: J(songBody('usr-a-over')) });
        expect(res.status).toBe(400);
        expect(((await res.json()) as any).error).toMatch(/too many/);
    });

    test('a furigana mismatch → 400 invalid, and the internal validation message is NOT leaked', async () => {
        signIn('a@x.com', 'atok');
        const res = await req('/v1/songs', {
            method: 'POST',
            token: 'atok',
            body: J(songBody('usr-a-bad', { lines: [{ text: 'ほんとう', furigana: [{ t: 'ちがう' }] }] })),
        });
        expect(res.status).toBe(400);
        const j = (await res.json()) as any;
        expect(j.error).toBe('invalid song');
        expect(j.detail).not.toContain('ちがう'); // the raw mismatched text must not be echoed
        expect(j.detail).not.toMatch(/reconstruct|slice/i); // nor the internal phrasing
    });
});

describe('GET / DELETE /v1/songs/{id} — ownership', () => {
    test("GET another user's private song → 404; the owner → 200", async () => {
        const a = signIn('a@x.com', 'atok');
        db.createSong({ extId: 'usr-a-1', title: 'mine', createdBy: a.id, lines: [{ text: 'やま', furigana: seg('やま') }] });
        expect((await req('/v1/songs/usr-a-1')).status).toBe(404); // anon
        expect((await req('/v1/songs/usr-a-1', { token: 'atok' })).status).toBe(200);
    });

    test('DELETE is owner-scoped (404 for a non-owner, 200 for the owner)', async () => {
        const a = signIn('a@x.com', 'atok');
        signIn('b@x.com', 'btok');
        db.createSong({ extId: 'usr-a-1', title: 'mine', createdBy: a.id, lines: [{ text: 'やま', furigana: seg('やま') }] });
        expect((await req('/v1/songs/usr-a-1', { method: 'DELETE', token: 'btok' })).status).toBe(404);
        expect((await req('/v1/songs/usr-a-1', { method: 'DELETE', token: 'atok' })).status).toBe(200);
        expect(db.getSong({ extId: 'usr-a-1', viewer: a.id })).toBeNull();
    });
});
