// Unit tests for the pure URL-builder + the Retry-After parser + the
// 429-with-backoff retry loop in ik.ts. Network calls are mocked via a
// globalThis.fetch override; we do NOT hit live IK in unit tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
    buildDownloadMediaUrl,
    parseRetryAfter,
    ikSearch,
    ikDownloadMedia,
    _ikFetchConfig,
} from './ik.ts';

describe('buildDownloadMediaUrl', () => {
    test('standard path', () => {
        expect(buildDownloadMediaUrl('anime', 'Fate Zero', 'foo.mp3')).toBe(
            'https://apiv2.immersionkit.com/download_media?path=media/anime/Fate%20Zero/media/foo.mp3',
        );
    });

    test('non-ASCII folder is percent-encoded segment-wise', () => {
        // The "×" in "Hunter × Hunter" must round-trip through IK's proxy.
        expect(buildDownloadMediaUrl('anime', 'Hunter × Hunter', '001.mp3')).toBe(
            'https://apiv2.immersionkit.com/download_media?path=media/anime/Hunter%20%C3%97%20Hunter/media/001.mp3',
        );
    });

    test('slashes stay literal between path segments', () => {
        // The five segments (media / category / folder / media / filename)
        // are joined with literal "/" — the encoding is per-segment, not
        // applied to the joined string.
        const url = buildDownloadMediaUrl('anime', 'Fate Zero', 'a.mp3');
        // Path part after `?path=` should have exactly 4 slashes for the 5 segments.
        const path = new URL(url).searchParams.get('path')!;
        expect(path.split('/').length).toBe(5);
    });

    test('special chars in filename are escaped', () => {
        expect(buildDownloadMediaUrl('anime', 'Foo', "a b&c.mp3")).toContain(
            'a%20b%26c.mp3',
        );
    });
});

describe('parseRetryAfter', () => {
    test('absent header returns null', () => {
        expect(parseRetryAfter(null)).toBeNull();
        expect(parseRetryAfter('')).toBeNull();
    });

    test('integer seconds → ms', () => {
        expect(parseRetryAfter('0')).toBe(0);
        expect(parseRetryAfter('5')).toBe(5000);
        expect(parseRetryAfter('120')).toBe(120_000);
    });

    test('fractional seconds round to nearest ms', () => {
        expect(parseRetryAfter('1.5')).toBe(1500);
    });

    test('HTTP-date in the future → ms until that moment', () => {
        const future = new Date(Date.now() + 10_000).toUTCString();
        const ms = parseRetryAfter(future);
        // Allow a tiny slop for clock drift between header construction and
        // parse — the underlying header lacks sub-second precision so the
        // computed wait is naturally within ~1s of the literal target.
        expect(ms).not.toBeNull();
        expect(ms!).toBeGreaterThan(8_000);
        expect(ms!).toBeLessThanOrEqual(10_000);
    });

    test('HTTP-date in the past → 0 (never negative)', () => {
        const past = new Date(Date.now() - 60_000).toUTCString();
        expect(parseRetryAfter(past)).toBe(0);
    });

    test('unparseable garbage → null', () => {
        expect(parseRetryAfter('not-a-date-or-number')).toBeNull();
    });

    test('negative seconds rejected (falls through to date parser, then null)', () => {
        expect(parseRetryAfter('-5')).toBeNull();
    });
});

describe('fetchJson 429 retry behavior (via ikSearch)', () => {
    const originalFetch = globalThis.fetch;
    const originalConfig = { ..._ikFetchConfig };

    beforeEach(() => {
        // Tiny waits so the suite stays fast. Don't touch maxRetries here —
        // individual tests assert the default (3) is honored.
        _ikFetchConfig.minGapMs = 0;
        _ikFetchConfig.baseBackoffMs = 5;
        _ikFetchConfig.maxBackoffMs = 50;
        _ikFetchConfig.maxRetries = 3;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        Object.assign(_ikFetchConfig, originalConfig);
    });

    function mockFetch(handler: (call: number) => Response | Promise<Response>) {
        let calls = 0;
        globalThis.fetch = (async (..._args: unknown[]) => {
            calls++;
            return handler(calls);
        }) as typeof fetch;
        return () => calls;
    }

    test('200 → no retry, returns parsed JSON', async () => {
        const calls = mockFetch(() =>
            new Response(JSON.stringify({ examples: [{ id: 'a' }] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }),
        );
        const out = await ikSearch('食べる');
        expect(calls()).toBe(1);
        expect(out).toEqual([{ id: 'a' }]);
    });

    test('429 then 200 → 1 retry, returns success', async () => {
        const calls = mockFetch((n) =>
            n === 1
                ? new Response('rate limited', { status: 429 })
                : new Response(JSON.stringify({ examples: [] }), {
                      status: 200,
                      headers: { 'content-type': 'application/json' },
                  }),
        );
        const out = await ikSearch('食べる');
        expect(calls()).toBe(2);
        expect(out).toEqual([]);
    });

    test('429 every time → throws after maxRetries+1 attempts', async () => {
        const calls = mockFetch(() => new Response('rate limited', { status: 429 }));
        await expect(ikSearch('食べる')).rejects.toThrow(/429/);
        // 1 initial + 3 retries = 4 total attempts.
        expect(calls()).toBe(_ikFetchConfig.maxRetries + 1);
    });

    test('500 → no retry, throws immediately (5xx is deliberately not retried)', async () => {
        const calls = mockFetch(() => new Response('boom', { status: 500 }));
        await expect(ikSearch('食べる')).rejects.toThrow(/500/);
        expect(calls()).toBe(1);
    });

    test('non-429 4xx (404) → no retry', async () => {
        const calls = mockFetch(() => new Response('nope', { status: 404 }));
        await expect(ikSearch('食べる')).rejects.toThrow(/404/);
        expect(calls()).toBe(1);
    });

    test('Retry-After header overrides exponential backoff (and is honored)', async () => {
        const waits: number[] = [];
        let lastAt = Date.now();
        const calls = mockFetch((n) => {
            const now = Date.now();
            if (n > 1) waits.push(now - lastAt);
            lastAt = now;
            if (n === 1) {
                // 30ms via Retry-After. Our baseBackoffMs is 5ms so without
                // the header the wait would be ~5ms; with the header, ≥30ms.
                return new Response('slow down', {
                    status: 429,
                    headers: { 'Retry-After': '0.03' },
                });
            }
            return new Response(JSON.stringify({ examples: [] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        });
        await ikSearch('食べる');
        expect(calls()).toBe(2);
        // The gap between attempt 1 and attempt 2 must reflect the
        // Retry-After value, not the (much smaller) exponential base.
        expect(waits[0]).toBeGreaterThanOrEqual(25);
    });

    test('ikDownloadMedia: 429 then 200-with-valid-body → 1 retry, ok:true', async () => {
        // Build a 2KB buffer (over the 1024-byte MIN_VALID_MEDIA_BYTES floor).
        const payload = new Uint8Array(2048).fill(0xAB);
        const calls = mockFetch((n) =>
            n === 1
                ? new Response('rate limited', { status: 429 })
                : new Response(payload, {
                      status: 200,
                      headers: { 'content-type': 'audio/mpeg' },
                  }),
        );
        const r = await ikDownloadMedia('https://example.test/foo.mp3');
        expect(calls()).toBe(2);
        expect(r.ok).toBe(true);
        expect(r.contentType).toBe('audio/mpeg');
        expect(r.buffer!.byteLength).toBe(2048);
    });

    test('ikDownloadMedia: 429 every time → returns failure (does NOT throw)', async () => {
        const calls = mockFetch(() => new Response('rate limited', { status: 429 }));
        const r = await ikDownloadMedia('https://example.test/foo.mp3');
        expect(calls()).toBe(_ikFetchConfig.maxRetries + 1);
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/429/);
    });

    test('ikDownloadMedia: 5xx → no retry, returns failure', async () => {
        const calls = mockFetch(() => new Response('boom', { status: 500 }));
        const r = await ikDownloadMedia('https://example.test/foo.mp3');
        expect(calls()).toBe(1);
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/500/);
    });

    test('ikDownloadMedia: 200 with body under 1KB → no retry, returns failure (proxy miss)', async () => {
        // IK's /download_media returns a near-empty body when the underlying
        // file is missing — a small body is a structural miss, not a transient
        // failure, so we deliberately don't retry it.
        const calls = mockFetch(() =>
            new Response(new Uint8Array(100), { status: 200, headers: { 'content-type': 'audio/mpeg' } }),
        );
        const r = await ikDownloadMedia('https://example.test/foo.mp3');
        expect(calls()).toBe(1);
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/body too small/);
    });

    test('Retry-After is capped at maxBackoffMs', async () => {
        // 999 seconds → must cap to maxBackoffMs (50ms in this test config).
        const waits: number[] = [];
        let lastAt = Date.now();
        mockFetch((n) => {
            const now = Date.now();
            if (n > 1) waits.push(now - lastAt);
            lastAt = now;
            if (n === 1) {
                return new Response('slow down', {
                    status: 429,
                    headers: { 'Retry-After': '999' },
                });
            }
            return new Response(JSON.stringify({ examples: [] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        });
        const t0 = Date.now();
        await ikSearch('食べる');
        const elapsed = Date.now() - t0;
        // If the cap weren't applied, the test would hang for 999s. Anything
        // well under a second proves the cap is working.
        expect(elapsed).toBeLessThan(500);
    });
});
