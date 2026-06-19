// Unit tests for the read-through media cache. No network: an in-memory Storage
// fake stands in for the real driver, and loaders are plain counting closures.
// Concurrency is exercised deterministically via a manual deferred (no sleeps).

import { describe, test, expect } from 'bun:test';
import type { Storage, PutOptions } from './storage.ts';
import {
    resolveMediaUrl,
    resolveMediaBytes,
    _mediaInFlightCount,
    type LoadedMedia,
} from './mediaCache.ts';

const buf = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer;
const str = (b: ArrayBuffer): string => new TextDecoder().decode(b);

// Minimal in-memory Storage implementing the full interface, with call counters
// and an optional "writes fail" switch to exercise the best-effort persist path.
class FakeStorage implements Storage {
    readonly objects = new Map<string, { body: ArrayBuffer; contentType: string; opts?: PutOptions }>();
    puts: Array<{ key: string; contentType: string; opts?: PutOptions }> = [];
    existsCalls = 0;
    getCalls = 0;
    failWrites = false;

    constructor(seed: Record<string, { body: string; contentType: string }> = {}) {
        for (const [k, v] of Object.entries(seed)) {
            this.objects.set(k, { body: buf(v.body), contentType: v.contentType });
        }
    }

    async put(key: string, body: ArrayBuffer | Uint8Array, contentType: string, opts?: PutOptions): Promise<string> {
        if (this.failWrites) throw new Error('storage down');
        const ab = body instanceof ArrayBuffer ? body : (body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer);
        this.objects.set(key, { body: ab, contentType, opts });
        this.puts.push({ key, contentType, opts });
        return this.publicUrl(key);
    }
    async exists(key: string): Promise<boolean> {
        this.existsCalls++;
        return this.objects.has(key);
    }
    async get(key: string): Promise<ArrayBuffer | null> {
        this.getCalls++;
        return this.objects.get(key)?.body ?? null;
    }
    async delete(key: string): Promise<void> {
        this.objects.delete(key);
    }
    publicUrl(key: string): string {
        return `https://cdn.example/${key}`;
    }
}

function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

describe('resolveMediaUrl (URL mode)', () => {
    test('cache hit returns publicUrl WITHOUT downloading bytes or calling the loader', async () => {
        const storage = new FakeStorage({ 'audio/x.mp3': { body: 'cached', contentType: 'audio/mpeg' } });
        let loadCalls = 0;
        const res = await resolveMediaUrl({
            storage,
            key: 'audio/x.mp3',
            load: async () => {
                loadCalls++;
                return { buffer: buf('fresh'), contentType: 'audio/mpeg' };
            },
        });
        expect(res).toEqual({ url: 'https://cdn.example/audio/x.mp3', source: 'cache' });
        expect(loadCalls).toBe(0); // never hit upstream on a hit
        expect(storage.getCalls).toBe(0); // exists() HEAD, never get() — no byte download
        expect(storage.puts.length).toBe(0);
    });

    test('miss loads upstream, persists, and returns the put URL', async () => {
        const storage = new FakeStorage();
        const res = await resolveMediaUrl({
            storage,
            key: 'image/y.jpg',
            load: async () => ({ buffer: buf('jpegbytes'), contentType: 'image/jpeg' }),
        });
        expect(res).toEqual({ url: 'https://cdn.example/image/y.jpg', source: 'fetched' });
        expect(storage.objects.has('image/y.jpg')).toBe(true);
        expect(str(storage.objects.get('image/y.jpg')!.body)).toBe('jpegbytes');
        expect(storage.objects.get('image/y.jpg')!.contentType).toBe('image/jpeg');
    });

    test('a loader that returns null degrades to {url:null, failed} and never writes', async () => {
        const storage = new FakeStorage();
        const res = await resolveMediaUrl({ storage, key: 'k', load: async () => null });
        expect(res).toEqual({ url: null, source: 'failed' });
        expect(storage.puts.length).toBe(0);
    });

    test('putOptions (e.g. acl:private) are passed through to storage.put', async () => {
        const storage = new FakeStorage();
        await resolveMediaUrl({
            storage,
            key: 'k',
            putOptions: { acl: 'private' },
            load: async () => ({ buffer: buf('b'), contentType: 'audio/mpeg' }),
        });
        expect(storage.puts[0]!.opts).toEqual({ acl: 'private' });
    });
});

describe('resolveMediaBytes (bytes mode)', () => {
    test('cache hit returns stored bytes with the caller-supplied content type, loader untouched', async () => {
        const storage = new FakeStorage({ 'tts/h.mp3': { body: 'mp3bytes', contentType: 'ignored' } });
        let loadCalls = 0;
        const res = await resolveMediaBytes({
            storage,
            key: 'tts/h.mp3',
            cachedContentType: 'audio/mpeg',
            load: async () => {
                loadCalls++;
                return { buffer: buf('x'), contentType: 'x' };
            },
        });
        expect(res.source).toBe('cache');
        expect(res.contentType).toBe('audio/mpeg'); // caller-declared type on a hit
        expect(str(res.buffer!)).toBe('mp3bytes');
        expect(res.persisted).toBeNull();
        expect(loadCalls).toBe(0);
    });

    test('miss returns fresh bytes immediately and persists them in the background', async () => {
        const storage = new FakeStorage();
        const res = await resolveMediaBytes({
            storage,
            key: 'minna/audio/a.mp3',
            cachedContentType: 'audio/mpeg',
            putOptions: { acl: 'private' },
            load: async () => ({ buffer: buf('native'), contentType: 'audio/mpeg' }),
        });
        expect(res.source).toBe('fetched');
        expect(str(res.buffer!)).toBe('native');
        // The body is returned before the write is guaranteed done; await the
        // background persist, then assert it landed with the right options.
        expect(res.persisted).not.toBeNull();
        await res.persisted;
        expect(storage.objects.has('minna/audio/a.mp3')).toBe(true);
        expect(storage.puts[0]!.opts).toEqual({ acl: 'private' });
    });

    test('a loader that returns null degrades to {buffer:null, failed}', async () => {
        const storage = new FakeStorage();
        const res = await resolveMediaBytes({ storage, key: 'k', cachedContentType: 'audio/mpeg', load: async () => null });
        expect(res).toEqual({ buffer: null, contentType: null, source: 'failed', persisted: null });
    });

    test('a storage-write outage is swallowed — bytes still serve, persisted resolves (not rejects)', async () => {
        const storage = new FakeStorage();
        storage.failWrites = true;
        const res = await resolveMediaBytes({
            storage,
            key: 'k',
            cachedContentType: 'audio/mpeg',
            load: async () => ({ buffer: buf('served-anyway'), contentType: 'audio/mpeg' }),
        });
        expect(res.source).toBe('fetched');
        expect(str(res.buffer!)).toBe('served-anyway');
        await expect(res.persisted).resolves.toBeUndefined(); // outage did not reject
        expect(storage.objects.has('k')).toBe(false); // write never landed, but the request succeeded
    });
});

describe('single-flight (thundering-herd protection)', () => {
    test('concurrent URL-mode misses for the same key share ONE upstream load', async () => {
        const storage = new FakeStorage();
        const d = deferred<LoadedMedia>();
        let loadCalls = 0;
        const load = () => {
            loadCalls++;
            return d.promise;
        };
        const a = resolveMediaUrl({ storage, key: 'same.mp3', load });
        const b = resolveMediaUrl({ storage, key: 'same.mp3', load });
        // let both pass the exists() check and reach the coalescing point
        await Promise.resolve();
        await Promise.resolve();
        d.resolve({ buffer: buf('once'), contentType: 'audio/mpeg' });
        const [ra, rb] = await Promise.all([a, b]);
        expect(ra.source).toBe('fetched');
        expect(rb.source).toBe('fetched');
        expect(loadCalls).toBe(1); // the herd collapsed to a single upstream fetch
        expect(_mediaInFlightCount()).toBe(0); // and the in-flight slot was freed
    });

    test('concurrent bytes-mode misses for the same key share ONE upstream load', async () => {
        const storage = new FakeStorage();
        const d = deferred<LoadedMedia>();
        let loadCalls = 0;
        const load = () => {
            loadCalls++;
            return d.promise;
        };
        const opts = { storage, key: 'shared.mp3', cachedContentType: 'audio/mpeg', load };
        const a = resolveMediaBytes(opts);
        const b = resolveMediaBytes(opts);
        await Promise.resolve();
        await Promise.resolve();
        d.resolve({ buffer: buf('one'), contentType: 'audio/mpeg' });
        const [ra, rb] = await Promise.all([a, b]);
        await Promise.all([ra.persisted, rb.persisted]);
        expect(str(ra.buffer!)).toBe('one');
        expect(str(rb.buffer!)).toBe('one');
        expect(loadCalls).toBe(1);
        expect(_mediaInFlightCount()).toBe(0);
    });
});
