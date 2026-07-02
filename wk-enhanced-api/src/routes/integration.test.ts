// Route-handler integration tests. Exercises the actual HTTP surface via
// Hono's in-process app.fetch() — no real server, no port binding, no
// external calls. Verifies the route wiring: status codes, headers,
// ETag round-trips, error-response shape, validation behavior.
//
// External services (IK / DDG / TTS) are NOT exercised. Any test path
// that would trigger warmWord() is either pre-seeded with upsertVocab or
// uses ?nowarm=true.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import { zodHook } from '../lib/zodHook.ts';
import { vocabRouter } from './vocab.ts';
import { healthRouter } from './health.ts';
import { indexMetaRouter } from './indexMeta.ts';
import { adminRouter } from './admin.ts';
import { progressRouter } from './progress.ts';
import { openDb, _useDbForTesting } from '../db/client.ts';
import * as db from '../db/client.ts';
import { _setWarmAllInFlightForTesting } from '../warm/pipeline.ts';
import { config } from '../config.ts';

let mem: ReturnType<typeof openDb>;
let app: OpenAPIHono;

beforeEach(() => {
    mem = openDb(':memory:');
    _useDbForTesting(mem);
    app = new OpenAPIHono({ defaultHook: zodHook });
    app.route('/v1/vocab', vocabRouter);
    app.route('/v1/health', healthRouter);
    app.route('/v1/index_meta', indexMetaRouter);
    app.route('/v1/admin', adminRouter);
    app.route('/v1/progress', progressRouter);
});

afterEach(() => {
    _useDbForTesting(null);
    mem.close();
});

function seedWord(word: string, fetchedAt: number, exampleCount = 0) {
    db.upsertVocab(
        word,
        {
            word,
            fetchedAt,
            examples: Array.from({ length: exampleCount }, (_, i) => ({
                id: `${word}_${i}`,
                sentence: { japanese: `${word}テスト${i}`, english: 'test' },
                source: { title: 'Test Deck', category: 'anime' },
                jlptMax: 5,
                hasOriginalAudio: false,
                audioUrl: null,
                imageUrl: null,
            })),
            fallbackImages: [],
        },
        exampleCount,
    );
}

describe('GET /v1/health', () => {
    test('returns ok status + warmedWords reflects DB row count', async () => {
        seedWord('食べる', 1000);
        seedWord('飲む', 1000);
        const res = await app.fetch(new Request('http://test.local/v1/health'));
        expect(res.status).toBe(200);
        const body = (await res.json()) as { status: string; warmedWords: number; version: string };
        expect(body.status).toBe('ok');
        expect(body.warmedWords).toBe(2);
        expect(typeof body.version).toBe('string');
    });

    test('sets Cache-Control: no-store so monitors see fresh state', async () => {
        const res = await app.fetch(new Request('http://test.local/v1/health'));
        expect(res.headers.get('cache-control')).toBe('no-store');
    });
});

describe('GET /v1/vocab/{word}', () => {
    test('serves a seeded row with 200 + ETag + Cache-Control', async () => {
        seedWord('食べる', 1779661959782, 2);
        const res = await app.fetch(new Request('http://test.local/v1/vocab/%E9%A3%9F%E3%81%B9%E3%82%8B'));
        expect(res.status).toBe(200);
        expect(res.headers.get('etag')).toBeTruthy();
        expect(res.headers.get('cache-control')).toContain('max-age=86400');
        const body = (await res.json()) as { word: string; examples: unknown[] };
        expect(body.word).toBe('食べる');
        expect(body.examples).toHaveLength(2);
    });

    test('cold miss with ?nowarm=true returns 404 with not_found code', async () => {
        const res = await app.fetch(
            new Request('http://test.local/v1/vocab/未収録?nowarm=true'),
        );
        expect(res.status).toBe(404);
        const body = (await res.json()) as { code: string; error: string };
        expect(body.code).toBe('not_found');
        expect(body.error).toBeTruthy();
    });

    test('ETag round-trip: matching If-None-Match returns 304 with no body', async () => {
        seedWord('foo', 1234);
        const first = await app.fetch(new Request('http://test.local/v1/vocab/foo'));
        expect(first.status).toBe(200);
        const etag = first.headers.get('etag');
        expect(etag).toBeTruthy();

        const second = await app.fetch(
            new Request('http://test.local/v1/vocab/foo', {
                headers: { 'If-None-Match': etag! },
            }),
        );
        expect(second.status).toBe(304);
        // Both responses must carry the same ETag header so caches can re-pin it.
        expect(second.headers.get('etag')).toBe(etag);
    });

    test('non-matching If-None-Match returns 200 + new ETag', async () => {
        seedWord('foo', 1234);
        const res = await app.fetch(
            new Request('http://test.local/v1/vocab/foo', {
                headers: { 'If-None-Match': '"stale"' },
            }),
        );
        expect(res.status).toBe(200);
        expect(res.headers.get('etag')).not.toBe('"stale"');
    });

    test('NFC normalization: decomposed and composed forms hit the same row', async () => {
        // "が" can be NFC-composed (U+304C) or NFD-decomposed ("か" + U+3099).
        // The route normalizes the path param so both spellings hit the same row.
        seedWord('が', 1000);
        const composed = await app.fetch(new Request('http://test.local/v1/vocab/が'));
        const decomposed = await app.fetch(
            new Request('http://test.local/v1/vocab/' + encodeURIComponent('が')),
        );
        expect(composed.status).toBe(200);
        expect(decomposed.status).toBe(200);
    });
});

describe('POST /v1/vocab/batch', () => {
    test('returns found/missing split for the requested words', async () => {
        seedWord('foo', 1000);
        seedWord('bar', 1000);
        const res = await app.fetch(
            new Request('http://test.local/v1/vocab/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ words: ['foo', 'bar', 'baz'] }),
            }),
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as { found: Record<string, unknown>; missing: string[] };
        expect(Object.keys(body.found).sort()).toEqual(['bar', 'foo']);
        expect(body.missing).toEqual(['baz']);
    });

    test('dedupes duplicates and preserves first-seen order in missing', async () => {
        const res = await app.fetch(
            new Request('http://test.local/v1/vocab/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ words: ['x', 'y', 'x', 'z', 'y'] }),
            }),
        );
        const body = (await res.json()) as { found: Record<string, unknown>; missing: string[] };
        expect(body.missing).toEqual(['x', 'y', 'z']);
    });

    test('rejects an empty words array with 400 + validation_error', async () => {
        const res = await app.fetch(
            new Request('http://test.local/v1/vocab/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ words: [] }),
            }),
        );
        expect(res.status).toBe(400);
        const body = (await res.json()) as { code: string };
        expect(body.code).toBe('validation_error');
    });
});

describe('GET /v1/index_meta', () => {
    test('seeded row → 200 with ETag + Cache-Control + body', async () => {
        db.upsertIndexMeta({ test_anime_2024: { title: 'Test Anime (2024)', category: 'anime' } });
        const res = await app.fetch(new Request('http://test.local/v1/index_meta'));
        expect(res.status).toBe(200);
        expect(res.headers.get('etag')).toBeTruthy();
        expect(res.headers.get('cache-control')).toContain('max-age=604800');
        const body = (await res.json()) as { fetchedAt: number; decks: Record<string, unknown> };
        expect(body.decks.test_anime_2024).toEqual({ title: 'Test Anime (2024)', category: 'anime' });
    });

    test('ETag round-trip: matching If-None-Match returns 304 with no body', async () => {
        db.upsertIndexMeta({ a: { title: 'A', category: 'anime' } });
        const first = await app.fetch(new Request('http://test.local/v1/index_meta'));
        expect(first.status).toBe(200);
        const etag = first.headers.get('etag');
        expect(etag).toBeTruthy();

        const second = await app.fetch(
            new Request('http://test.local/v1/index_meta', {
                headers: { 'If-None-Match': etag! },
            }),
        );
        expect(second.status).toBe(304);
        // 304 must echo the same ETag + Cache-Control so caches can re-pin them.
        expect(second.headers.get('etag')).toBe(etag);
        expect(second.headers.get('cache-control')).toContain('max-age=604800');
    });

    test('weak-prefixed If-None-Match (Cloudflare downgrade) also matches', async () => {
        // Cloudflare rewrites strong ETags to weak (W/"...") on compressed
        // responses. The userscript stores and re-sends the weak form; we
        // strip W/ before comparison so the 304 path still fires.
        db.upsertIndexMeta({ a: { title: 'A', category: 'anime' } });
        const first = await app.fetch(new Request('http://test.local/v1/index_meta'));
        const etag = first.headers.get('etag')!;
        const second = await app.fetch(
            new Request('http://test.local/v1/index_meta', {
                headers: { 'If-None-Match': `W/${etag}` },
            }),
        );
        expect(second.status).toBe(304);
    });

    test('non-matching If-None-Match returns 200 + current ETag', async () => {
        db.upsertIndexMeta({ a: { title: 'A', category: 'anime' } });
        const res = await app.fetch(
            new Request('http://test.local/v1/index_meta', {
                headers: { 'If-None-Match': '"stale"' },
            }),
        );
        expect(res.status).toBe(200);
        expect(res.headers.get('etag')).not.toBe('"stale"');
    });
});

describe('POST /v1/admin/warm — concurrency guard', () => {
    const authHeader = () => ({ Authorization: `Bearer ${config.adminToken}` });

    afterEach(() => {
        // Clean the flag in case a test forgot to.
        _setWarmAllInFlightForTesting(false);
    });

    test('scope:all returns 409 when a warmAll is already in flight', async () => {
        _setWarmAllInFlightForTesting(true);
        const res = await app.fetch(
            new Request('http://test.local/v1/admin/warm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeader() },
                body: JSON.stringify({ scope: 'all' }),
            }),
        );
        expect(res.status).toBe(409);
        const body = (await res.json()) as { code: string; error: string };
        expect(body.code).toBe('conflict');
        expect(body.error).toMatch(/warm-all already in flight/);
    });

    test('scope:all returns 401 when the bearer token is missing (auth check runs before in-flight check)', async () => {
        // Same in-flight state — verifies the auth gate isn't bypassed by
        // the in-flight short-circuit.
        _setWarmAllInFlightForTesting(true);
        const res = await app.fetch(
            new Request('http://test.local/v1/admin/warm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scope: 'all' }),
            }),
        );
        expect(res.status).toBe(401);
    });
});

describe('PUT /v1/progress/{app} — optimistic concurrency (B4)', () => {
    function signIn(email: string, token: string) {
        const u = db.createUser(email, 'h');
        db.createSession(token, u.id, Date.now() + 100_000);
    }
    function putProgress(token: string, appName: string, body: unknown) {
        return app.fetch(
            new Request('http://test.local/v1/progress/' + appName, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Cookie: 'wk_session=' + token },
                body: JSON.stringify(body),
            }),
        );
    }

    test('first PUT (no base) writes; a stale baseUpdatedAt → 409 carrying the current copy', async () => {
        signIn('cc@b.com', 'cctok');
        let res = await putProgress('cctok', 'verbs', { data: { cards: { 1: {} } } });
        expect(res.status).toBe(200);
        const { updatedAt } = (await res.json()) as { updatedAt: number };

        res = await putProgress('cctok', 'verbs', { data: { cards: { 2: {} } }, baseUpdatedAt: updatedAt - 1 });
        expect(res.status).toBe(409);
        const body = (await res.json()) as { code: string; data: any; updatedAt: number };
        expect(body.code).toBe('conflict');
        expect(body.updatedAt).toBe(updatedAt);
        expect(body.data).toEqual({ cards: { 1: {} } });   // server copy, not the rejected write
    });

    test('a matching baseUpdatedAt writes (200)', async () => {
        signIn('cc2@b.com', 'cc2tok');
        let res = await putProgress('cc2tok', 'verbs', { data: { v: 1 } });
        const { updatedAt } = (await res.json()) as { updatedAt: number };
        res = await putProgress('cc2tok', 'verbs', { data: { v: 2 }, baseUpdatedAt: updatedAt });
        expect(res.status).toBe(200);
    });

    test('PUT without a valid session is 401', async () => {
        const res = await putProgress('', 'verbs', { data: { v: 1 } });
        expect(res.status).toBe(401);
    });

    test('the songs app namespace is accepted (enum widen)', async () => {
        signIn('cc3@b.com', 'cc3tok');
        const res = await putProgress('cc3tok', 'songs', {
            data: { progress: { 'song-x': { starred: [1], shadowed: [0, 2], lastMode: 'shadow' } } },
        });
        expect(res.status).toBe(200);
    });

    test('the wanikani app namespace is accepted (enum widen)', async () => {
        signIn('cc4@b.com', 'cc4tok');
        const res = await putProgress('cc4tok', 'wanikani', {
            data: { token: '00000000-0000-0000-0000-000000000000' },
        });
        expect(res.status).toBe(200);
    });

    test('the jlpt app namespace is accepted (enum widen)', async () => {
        signIn('cc5@b.com', 'cc5tok');
        const res = await putProgress('cc5tok', 'jlpt', {
            data: { level: 'N3', examDate: '2026-12-06', days: { '2026-07-01': { due: 1, speak: 1 } } },
        });
        expect(res.status).toBe(200);
    });
});
