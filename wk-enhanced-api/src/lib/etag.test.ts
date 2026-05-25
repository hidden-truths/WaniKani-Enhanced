import { describe, test, expect } from 'bun:test';
import { etagFor, normalizeEtag } from './etag.ts';

describe('etagFor', () => {
    test('wraps a base36-encoded fetchedAt in double quotes', () => {
        expect(etagFor(0)).toBe('"0"');
        expect(etagFor(1)).toBe('"1"');
        // 36 → 10 in base36; 1779661959782 → some short base36 string.
        expect(etagFor(36)).toBe('"10"');
    });

    test('produces a strong ETag (no W/ weak prefix)', () => {
        // We only re-warm atomically, so same fetchedAt always means
        // byte-identical payload. Strong ETag is correct.
        expect(etagFor(1779661959782).startsWith('"')).toBe(true);
        expect(etagFor(1779661959782).startsWith('W/')).toBe(false);
    });

    test('different fetchedAt values produce different ETags', () => {
        expect(etagFor(1000)).not.toBe(etagFor(1001));
    });
});

describe('normalizeEtag', () => {
    test('passes a strong ETag through unchanged', () => {
        expect(normalizeEtag('"abc"')).toBe('"abc"');
    });

    test('strips the W/ prefix from a weak ETag', () => {
        expect(normalizeEtag('W/"abc"')).toBe('"abc"');
    });

    test('weak and strong forms of the same opaque tag normalize equal', () => {
        // This is the practical invariant — once both client-supplied
        // If-None-Match and our origin ETag pass through this, the
        // strict-equality comparison in the route handler will short-
        // circuit a Cloudflare-weakened revalidation back to a 304.
        expect(normalizeEtag('W/"mpli0kwq"')).toBe(normalizeEtag('"mpli0kwq"'));
    });

    test('handles empty / undefined inputs without throwing', () => {
        expect(normalizeEtag(undefined)).toBe(undefined);
        expect(normalizeEtag('')).toBe('');
    });
});
