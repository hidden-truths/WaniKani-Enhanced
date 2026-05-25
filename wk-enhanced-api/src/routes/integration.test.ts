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
import { openDb, _useDbForTesting } from '../db/client.ts';
import * as db from '../db/client.ts';

let mem: ReturnType<typeof openDb>;
let app: OpenAPIHono;

beforeEach(() => {
    mem = openDb(':memory:');
    _useDbForTesting(mem);
    app = new OpenAPIHono({ defaultHook: zodHook });
    app.route('/v1/vocab', vocabRouter);
    app.route('/v1/health', healthRouter);
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
