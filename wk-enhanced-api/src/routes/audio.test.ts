// Integration tests for the native-audio route (GET /v1/audio/native) via Hono's
// in-process app.fetch(): the owner gate, the SSRF path guard, and — the point —
// the read-through cache the route now shares with the warm pipeline + TTS
// (services/mediaCache.ts, bytes mode). A fake Storage (injected through the new
// `_setStorageForTesting` seam) plus a `globalThis.fetch` stub stand in for DO
// Spaces and vnjpclub, so no network is touched (matching the suite convention).
// The TTS / variants / recordings handlers are covered elsewhere; this file pins
// the bytes-mode mediaCache adoption end-to-end through a real request.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import { zodHook } from '../lib/zodHook.ts';
import { audioRouter } from './audio.ts';
import { openDb, _useDbForTesting } from '../db/client.ts';
import * as db from '../db/client.ts';
import { keys, _setStorageForTesting, type Storage, type PutOptions } from '../services/storage.ts';
import { config } from '../config.ts';

// Minimal in-memory Storage implementing the full interface.
class FakeStorage implements Storage {
    readonly objects = new Map<string, { body: ArrayBuffer; contentType: string; opts?: PutOptions }>();
    async put(key: string, body: ArrayBuffer | Uint8Array, contentType: string, opts?: PutOptions): Promise<string> {
        const ab =
            body instanceof ArrayBuffer
                ? body
                : (body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer);
        this.objects.set(key, { body: ab, contentType, opts });
        return this.publicUrl(key);
    }
    async exists(key: string): Promise<boolean> {
        return this.objects.has(key);
    }
    async get(key: string): Promise<ArrayBuffer | null> {
        return this.objects.get(key)?.body ?? null;
    }
    async delete(key: string): Promise<void> {
        this.objects.delete(key);
    }
    publicUrl(key: string): string {
        return 'https://cdn.test/' + key;
    }
}

const SRC = '/Audio/minnamoi/bai23/abc.mp3';
const bytes = (n: number): ArrayBuffer => new Uint8Array(n).fill(65).buffer; // >=1024 passes fetchMinnaAudio's <1KB guard

let mem: ReturnType<typeof openDb>;
let app: OpenAPIHono;
let storage: FakeStorage;
let realFetch: typeof globalThis.fetch;
let realOwnerEmails: string[];

beforeEach(() => {
    mem = openDb(':memory:');
    _useDbForTesting(mem);
    storage = new FakeStorage();
    _setStorageForTesting(storage);
    app = new OpenAPIHono({ defaultHook: zodHook });
    app.route('/v1/audio', audioRouter);
    realFetch = globalThis.fetch;
    // Pin the gate to its documented "any signed-in user" default so the test
    // doesn't depend on the developer's local MINNA_OWNER_EMAILS allowlist.
    // (config.minna.ownerEmails is readonly at the type level — narrow-cast to
    // mutate it for the test, then restore in afterEach.)
    realOwnerEmails = [...config.minna.ownerEmails];
    (config.minna as { ownerEmails: string[] }).ownerEmails = [];
});

afterEach(() => {
    _useDbForTesting(null);
    _setStorageForTesting(null);
    globalThis.fetch = realFetch;
    (config.minna as { ownerEmails: string[] }).ownerEmails = realOwnerEmails;
    mem.close();
});

function signIn(token: string) {
    const u = db.createUser('a@b.c', 'h');
    db.createSession(token, u.id, Date.now() + 100_000);
    return u;
}
const get = (path: string, token?: string) => {
    const headers = new Headers();
    if (token) headers.set('Cookie', 'wk_session=' + token);
    return app.fetch(new Request('http://test.local' + path, { headers }));
};
const nativePath = (src: string) => '/v1/audio/native?src=' + encodeURIComponent(src);
const jsonCode = async (res: Response): Promise<string> => ((await res.json()) as { code: string }).code;
const noFetch = (msg: string) =>
    (() => {
        throw new Error(msg);
    }) as unknown as typeof globalThis.fetch;

describe('GET /v1/audio/native — gate + validation', () => {
    test('an anonymous request is denied 401', async () => {
        const res = await get(nativePath(SRC));
        expect(res.status).toBe(401);
        expect(await jsonCode(res)).toBe('unauthorized');
    });

    test('a non-/Audio path is rejected 400 (SSRF guard), no upstream call', async () => {
        signIn('t');
        globalThis.fetch = noFetch('must not fetch on a bad path');
        const res = await get(nativePath('/etc/passwd'), 't');
        expect(res.status).toBe(400);
        expect(await jsonCode(res)).toBe('validation_error');
    });
});

describe('GET /v1/audio/native — read-through cache (mediaCache bytes mode)', () => {
    test('cache HIT serves stored bytes with private headers and never hits upstream', async () => {
        signIn('t');
        await storage.put(keys.minnaAudio(SRC), bytes(2048), 'audio/mpeg', { acl: 'private' });
        globalThis.fetch = noFetch('must not fetch on a cache hit');

        const res = await get(nativePath(SRC), 't');
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
        // PRIVATE, never a shared/CDN cache — gated copyrighted content.
        expect(res.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable');
        expect((await res.arrayBuffer()).byteLength).toBe(2048);
    });

    test('cache MISS fetches upstream once, persists PRIVATE, then later requests serve from cache', async () => {
        signIn('t');
        let fetchCalls = 0;
        globalThis.fetch = (async () => {
            fetchCalls++;
            return new Response(bytes(4096), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
        }) as unknown as typeof globalThis.fetch;

        const res = await get(nativePath(SRC), 't');
        expect(res.status).toBe(200);
        expect((await res.arrayBuffer()).byteLength).toBe(4096);
        expect(fetchCalls).toBe(1);

        // The persist is fire-and-forget (off the response path); wait for it to land.
        const key = keys.minnaAudio(SRC);
        for (let i = 0; i < 100 && !storage.objects.has(key); i++) await new Promise((r) => setTimeout(r, 1));
        expect(storage.objects.get(key)!.opts).toEqual({ acl: 'private' });

        // A second request with upstream now throwing must still succeed — from cache.
        globalThis.fetch = noFetch('should be served from cache now');
        const res2 = await get(nativePath(SRC), 't');
        expect(res2.status).toBe(200);
        expect((await res2.arrayBuffer()).byteLength).toBe(4096);
        expect(fetchCalls).toBe(1); // still one — the second read hit the cache, not upstream
    });

    test('an upstream miss (tiny body) degrades to 502', async () => {
        signIn('t');
        // <1KB body → fetchMinnaAudio treats it as a missing file → null → 502.
        globalThis.fetch = (async () => new Response(bytes(100), { status: 200 })) as unknown as typeof globalThis.fetch;
        const res = await get(nativePath(SRC), 't');
        expect(res.status).toBe(502);
        expect(await jsonCode(res)).toBe('upstream_failure');
    });
});
