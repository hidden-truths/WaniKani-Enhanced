import { describe, test, expect } from 'bun:test';
import { etagFor } from './vocab.ts';

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
